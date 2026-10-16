/**
 * Recurring events: a series is an `event_series` row plus its occurrences,
 * stored `events` rows with `series_id`. A series has ONE forum post
 * (`event_series.topic_id`, set by the bot) and its own linked posts
 * (`event_topics.series_id`); occurrences' own `topic_id` stays NULL. Bot
 * requests for a series target `series:<id>`. Edit/delete take a scope: "one"
 * occurrence or "following" (it and all later ones).
 */
import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import type { ActionResult } from './admin-actions.js';
import { writeAudit } from './audit.js';
import { enqueueBotRequest } from './bot-requests.js';
import type { Db, DbExecutor } from './client.js';
import {
  checkAddRateLimit,
  checkUser,
  diffFields,
  type EventInput,
  type EventRow,
  type EventSource,
  type Fields,
  isRefusal,
  jsonFields,
  MAX_EVENT_LINKS,
  NOT_FOUND,
  refused,
  rowFields,
  type Scope,
  validateEvent,
  validatePatch,
} from './events.js';
import { eventSeries, events, eventTopics, topics } from './schema.js';

export type SeriesRule = 'weekly' | 'biweekly';
export type SeriesInput = EventInput & { rule: SeriesRule; until: string };

export const MAX_SERIES_OCCURRENCES = 30;
const DAY_MS = 86_400_000;
const STEP_DAYS: Record<SeriesRule, number> = { weekly: 7, biweekly: 14 };

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const dayStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const upsertSeries = (db: DbExecutor, id: number) =>
  enqueueBotRequest(db, 'event_post_upsert', `series:${id}`);
const archiveSeries = (db: DbExecutor, id: number) =>
  enqueueBotRequest(db, 'event_post_archive', `series:${id}`);

/** `DD.MM.RRRR`, `RRRR-MM-DD`, or `DD.MM` (the first such day on/after `from`). */
function parseUntil(text: string, from: Date): Date | null {
  const t = (text ?? '').trim();
  let y: number;
  let m: number;
  let d: number;
  let yearGiven = true;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  const dm = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(t);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dmy) {
    [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  } else if (dm) {
    [d, m] = [Number(dm[1]), Number(dm[2])];
    y = from.getUTCFullYear();
    yearGiven = false;
  } else return null;
  const build = (yy: number) => {
    const dt = new Date(Date.UTC(yy, m - 1, d));
    return dt.getUTCFullYear() === yy &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
      ? dt
      : null;
  };
  let dt = build(y);
  if (dt && !yearGiven && dt < dayStart(from)) dt = build(y + 1);
  return dt;
}

/** Wall start/end of each occurrence of a rule. Refusal message on a cap. */
function occurrenceTimes(
  first: Fields,
  rule: SeriesRule,
  until: Date,
):
  | { ok: true; times: { startsAt: Date; endsAt: Date | null }[] }
  | { ok: false; message: string } {
  const limit = new Date(first.startsAt);
  limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  const times: { startsAt: Date; endsAt: Date | null }[] = [];
  const dur = first.endsAt
    ? first.endsAt.getTime() - first.startsAt.getTime()
    : null;
  for (let k = 0; ; k++) {
    const startsAt = new Date(
      first.startsAt.getTime() + k * STEP_DAYS[rule] * DAY_MS,
    );
    if (dayStart(startsAt) > until) break;
    if (startsAt > limit) {
      return {
        ok: false,
        message: 'Ostatnie wystąpienie może być najwyżej rok po pierwszym.',
      };
    }
    if (k >= MAX_SERIES_OCCURRENCES) {
      return {
        ok: false,
        message: `Cykl może mieć najwyżej ${MAX_SERIES_OCCURRENCES} wystąpień.`,
      };
    }
    times.push({
      startsAt,
      endsAt: dur === null ? null : new Date(startsAt.getTime() + dur),
    });
  }
  return { ok: true, times };
}

/** Creates the series and all its occurrences; one upsert for `series:<id>`. */
export async function addSeries(
  db: Db,
  userId: number,
  input: SeriesInput,
  source: EventSource,
): Promise<ActionResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return user;
  if (input.rule !== 'weekly' && input.rule !== 'biweekly') {
    return refused('Nieznana reguła powtarzania.');
  }
  const v = await validateEvent(db, input);
  if (!v.ok) return refused(v.message);
  const f = v.fields;
  const until = parseUntil(input.until, f.startsAt);
  if (!until) {
    return refused('Data końca cyklu ma format DD.MM.RRRR (np. 15.12.2026).');
  }
  if (until < dayStart(f.startsAt)) {
    return refused(
      'Data końca cyklu nie może być przed pierwszym wydarzeniem.',
    );
  }
  const gen = occurrenceTimes(f, input.rule, until);
  if (!gen.ok) return refused(gen.message);
  return db.transaction(async (tx) => {
    const limited = await checkAddRateLimit(tx, userId);
    if (limited) return limited;
    const [s] = await tx
      .insert(eventSeries)
      .values({ rule: input.rule, until: isoDate(until), createdBy: userId });
    const seriesId = s.insertId;
    await tx.insert(events).values(
      gen.times.map((t) => ({
        ...f,
        ...t,
        seriesId,
        createdBy: userId,
        updatedBy: userId,
      })),
    );
    await writeAudit(tx, {
      userId,
      action: 'event.add',
      target: `series:${seriesId}`,
      details: {
        source,
        rule: input.rule,
        until: isoDate(until),
        count: gen.times.length,
        fields: jsonFields(f),
      },
    });
    await upsertSeries(tx, seriesId);
    return {
      ok: true,
      message: `Dodano cykl (${gen.times.length} wydarzeń).`,
      id: seriesId,
    };
  });
}

/** Topic ids behind a series: its own post plus linked posts. */
export async function seriesTopicIds(
  db: DbExecutor,
  seriesId: number,
): Promise<number[]> {
  const [s] = await db
    .select({ topicId: eventSeries.topicId })
    .from(eventSeries)
    .where(eq(eventSeries.id, seriesId));
  const links = await db
    .select({ topicId: eventTopics.topicId })
    .from(eventTopics)
    .where(eq(eventTopics.seriesId, seriesId));
  return [
    ...(s?.topicId == null ? [] : [s.topicId]),
    ...links.map((l) => l.topicId),
  ];
}

/** Undeletes a series after one of its occurrences was restored. */
export async function reviveSeries(tx: DbExecutor, seriesId: number) {
  await tx
    .update(eventSeries)
    .set({ deletedAt: null })
    .where(eq(eventSeries.id, seriesId));
  await upsertSeries(tx, seriesId);
}

const liveOccurrences = (db: DbExecutor, seriesId: number) =>
  db
    .select()
    .from(events)
    .where(and(eq(events.seriesId, seriesId), isNull(events.deletedAt)))
    .orderBy(asc(events.startsAt), asc(events.id));

/** Fields of a later occurrence after the target's patch is applied to it. */
async function followingFields(
  db: DbExecutor,
  other: EventRow,
  patch: Partial<EventInput>,
  curTarget: Fields,
  nextTarget: Fields,
): Promise<{ ok: true; fields: Fields } | { ok: false; message: string }> {
  const cur = rowFields(other);
  const v = await validatePatch(db, cur, { ...patch, when: undefined });
  if (!v.ok) return v;
  if (patch.when === undefined) return v;
  // Same day offset and the new time of day, so the whole tail moves together.
  const dayShift =
    dayStart(nextTarget.startsAt).getTime() -
    dayStart(curTarget.startsAt).getTime();
  const startsAt = new Date(
    dayStart(cur.startsAt).getTime() +
      dayShift +
      (nextTarget.startsAt.getTime() - dayStart(nextTarget.startsAt).getTime()),
  );
  const endsAt = nextTarget.endsAt
    ? new Date(
        startsAt.getTime() +
          (nextTarget.endsAt.getTime() - nextTarget.startsAt.getTime()),
      )
    : null;
  return {
    ok: true,
    fields: { ...v.fields, startsAt, endsAt, allDay: nextTarget.allDay },
  };
}

export async function editInSeries(
  db: Db,
  userId: number,
  row: EventRow,
  patch: Partial<EventInput>,
  source: EventSource,
  scope: Scope,
): Promise<ActionResult> {
  const seriesId = row.seriesId as number;
  const curTarget = rowFields(row);
  const vt = await validatePatch(db, curTarget, patch);
  if (!vt.ok) return refused(vt.message);
  const nextTarget = vt.fields;
  const all = await liveOccurrences(db, seriesId);
  const idx = all.findIndex((e) => e.id === row.id);
  const targets = scope === 'following' ? all.slice(idx) : [row];
  const plan: {
    row: EventRow;
    changes: ReturnType<typeof diffFields>;
    next: Fields;
  }[] = [];
  for (const t of targets) {
    let next = nextTarget;
    if (t.id !== row.id) {
      const f = await followingFields(db, t, patch, curTarget, nextTarget);
      if (!f.ok) return refused(f.message);
      next = f.fields;
    }
    plan.push({ row: t, changes: diffFields(rowFields(t), next), next });
  }
  const changed = plan.filter((p) => Object.keys(p.changes).length > 0);
  if (changed.length === 0) {
    // Saving unchanged retries a post that never got made.
    const [s] = await db
      .select({ topicId: eventSeries.topicId })
      .from(eventSeries)
      .where(eq(eventSeries.id, seriesId));
    if (s && s.topicId === null) await upsertSeries(db, seriesId);
    return { ok: true, message: 'Brak zmian.' };
  }
  return db.transaction(async (tx) => {
    const [series] = await tx
      .select()
      .from(eventSeries)
      .where(eq(eventSeries.id, seriesId))
      .for('update');
    if (!series) return refused(NOT_FOUND);
    let targetSeries = seriesId;
    const touched = [seriesId];
    const split = scope === 'following' && idx > 0;
    if (split) {
      const [ns] = await tx.insert(eventSeries).values({
        rule: series.rule,
        until: series.until,
        topicId: series.topicId,
        // Lineage root, so every split of one series shares one post.
        parentId: series.parentId ?? series.id,
        createdBy: series.createdBy,
      });
      targetSeries = ns.insertId;
      touched.push(targetSeries);
      const links = await tx
        .select({ topicId: eventTopics.topicId })
        .from(eventTopics)
        .where(eq(eventTopics.seriesId, seriesId));
      if (links.length > 0) {
        await tx
          .insert(eventTopics)
          .values(
            links.map((l) => ({ seriesId: targetSeries, topicId: l.topicId })),
          );
      }
      await tx
        .update(eventSeries)
        .set({ until: isoDate(all[idx - 1].startsAt) })
        .where(eq(eventSeries.id, seriesId));
    }
    const now = new Date();
    for (const p of plan) {
      await tx
        .update(events)
        .set({
          ...(Object.keys(p.changes).length > 0
            ? { ...p.next, updatedBy: userId, updatedAt: now }
            : {}),
          seriesId: targetSeries,
        })
        .where(eq(events.id, p.row.id));
    }
    if (scope === 'following') {
      const last = plan
        .map((p) => p.next.startsAt)
        .reduce((a, b) => (a > b ? a : b));
      const lastIso = isoDate(last);
      if (lastIso > series.until) {
        await tx
          .update(eventSeries)
          .set({ until: lastIso })
          .where(eq(eventSeries.id, targetSeries));
      }
    }
    await writeAudit(tx, {
      userId,
      action: 'event.edit',
      target: String(row.id),
      details: {
        source,
        scope,
        seriesId: targetSeries,
        affected: plan.length,
        changes: plan.find((p) => p.row.id === row.id)?.changes ?? {},
      },
    });
    for (const id of touched) await upsertSeries(tx, id);
    return { ok: true, message: 'Zapisano zmiany.' };
  });
}

export async function deleteInSeries(
  db: Db,
  userId: number,
  row: EventRow,
  source: EventSource,
  scope: Scope,
): Promise<ActionResult> {
  const seriesId = row.seriesId as number;
  return db.transaction(async (tx) => {
    await tx
      .select({ id: eventSeries.id })
      .from(eventSeries)
      .where(eq(eventSeries.id, seriesId))
      .for('update');
    const where =
      scope === 'following'
        ? and(
            eq(events.seriesId, seriesId),
            isNull(events.deletedAt),
            gte(events.startsAt, row.startsAt),
          )
        : and(eq(events.id, row.id), isNull(events.deletedAt));
    const now = new Date();
    const [res] = await tx
      .update(events)
      .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
      .where(where);
    if (res.affectedRows === 0) return refused(NOT_FOUND);
    await writeAudit(tx, {
      userId,
      action: 'event.delete',
      target: String(row.id),
      details: { source, scope, seriesId, affected: res.affectedRows },
    });
    const left = await liveOccurrences(tx, seriesId);
    if (left.length === 0) {
      await tx
        .update(eventSeries)
        .set({ deletedAt: now })
        .where(eq(eventSeries.id, seriesId));
      await archiveSeries(tx, seriesId);
    } else {
      await tx
        .update(eventSeries)
        .set({ until: isoDate(left[left.length - 1].startsAt) })
        .where(eq(eventSeries.id, seriesId));
      await upsertSeries(tx, seriesId);
    }
    return {
      ok: true,
      message:
        scope === 'following' ? 'Usunięto wydarzenia.' : 'Usunięto wydarzenie.',
    };
  });
}

/** Subject shared by the series' live occurrences (NULL: any post fits). */
async function seriesSubject(
  tx: DbExecutor,
  seriesId: number,
): Promise<{ found: boolean; subjectId: number | null }> {
  const [e] = await tx
    .select({ subjectId: events.subjectId })
    .from(events)
    .innerJoin(eventSeries, eq(eventSeries.id, events.seriesId))
    .where(
      and(
        eq(events.seriesId, seriesId),
        isNull(events.deletedAt),
        isNull(eventSeries.deletedAt),
      ),
    )
    .limit(1);
  return e
    ? { found: true, subjectId: e.subjectId }
    : { found: false, subjectId: null };
}

export async function linkSeriesTopic(
  db: Db,
  userId: number,
  seriesId: number,
  topicId: number,
  source: EventSource,
): Promise<ActionResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return user;
  return db.transaction(async (tx) => {
    await tx
      .select({ id: eventSeries.id })
      .from(eventSeries)
      .where(and(eq(eventSeries.id, seriesId), isNull(eventSeries.deletedAt)))
      .for('update');
    const subj = await seriesSubject(tx, seriesId);
    if (!subj.found) return refused(NOT_FOUND);
    const [t] = await tx
      .select({ subjectId: topics.subjectId })
      .from(topics)
      .where(and(eq(topics.id, topicId), isNull(topics.deletedAt)));
    if (!t) return refused('Nie znaleziono posta.');
    if (subj.subjectId !== null && t.subjectId !== subj.subjectId) {
      return refused('Ten post należy do innego przedmiotu.');
    }
    const links = await tx
      .select({ topicId: eventTopics.topicId })
      .from(eventTopics)
      .where(eq(eventTopics.seriesId, seriesId));
    if (links.some((l) => l.topicId === topicId)) {
      return refused('Ten post jest już powiązany.');
    }
    if (links.length >= MAX_EVENT_LINKS) {
      return refused(`Można powiązać najwyżej ${MAX_EVENT_LINKS} postów.`);
    }
    await tx.insert(eventTopics).values({ seriesId, topicId });
    await writeAudit(tx, {
      userId,
      action: 'event.link',
      target: `series:${seriesId}`,
      details: { source, topicId },
    });
    await upsertSeries(tx, seriesId);
    return { ok: true, message: 'Powiązano post.' };
  });
}

export async function unlinkSeriesTopic(
  db: Db,
  userId: number,
  seriesId: number,
  topicId: number,
  source: EventSource,
): Promise<ActionResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return user;
  return db.transaction(async (tx) => {
    const [res] = await tx
      .delete(eventTopics)
      .where(
        and(
          eq(eventTopics.seriesId, seriesId),
          eq(eventTopics.topicId, topicId),
        ),
      );
    if (res.affectedRows === 0) return refused('Ten post nie jest powiązany.');
    await writeAudit(tx, {
      userId,
      action: 'event.unlink',
      target: `series:${seriesId}`,
      details: { source, topicId },
    });
    await upsertSeries(tx, seriesId);
    return { ok: true, message: 'Usunięto powiązanie.' };
  });
}

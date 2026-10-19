/**
 * Recurring events: a series is an `event_series` row plus its occurrences,
 * stored `events` rows with `series_id`. A series has ONE forum post
 * (`event_series.topic_id`, set by the bot) and its own linked posts
 * (`event_topics.series_id`); occurrences' own `topic_id` stays NULL. Bot
 * requests for a series target `series:<id>`. Edit/delete take a scope: "one"
 * occurrence or "following" (it and all later ones).
 */

import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { ActionResult } from './admin-actions.js';
import { writeAudit } from './audit.js';
import { enqueueBotRequest } from './bot-requests.js';
import type { Db, DbExecutor } from './client.js';
import {
  bumpEvent,
  checkAddRateLimit,
  checkExpectedVersion,
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
  type VersionOpts,
  validateEvent,
  validatePatch,
} from './events.js';
import { eventSeries, events, eventTopics, topics } from './schema.js';
import { withTxRetry } from './tx.js';

export type SeriesRule = 'weekly' | 'biweekly';
export type SeriesInput = EventInput & { rule: SeriesRule; until: string };

export const MAX_SERIES_OCCURRENCES = 30;
const DAY_MS = 86_400_000;
const STEP_DAYS: Record<SeriesRule, number> = { weekly: 7, biweekly: 14 };

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const dayStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const bumpSeries = sql`${eventSeries.version} + 1`;

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
        message: 'The last occurrence can be at most a year after the first.',
      };
    }
    if (k >= MAX_SERIES_OCCURRENCES) {
      return {
        ok: false,
        message: `A series can have at most ${MAX_SERIES_OCCURRENCES} occurrences.`,
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
    return refused('Unknown repeat rule.');
  }
  const v = await validateEvent(db, input);
  if (!v.ok) return refused(v.message);
  const f = v.fields;
  const until = parseUntil(input.until, f.startsAt);
  if (!until) {
    return refused('The series end date must be DD.MM.YYYY (e.g. 15.12.2026).');
  }
  if (until < dayStart(f.startsAt)) {
    return refused('The series end date cannot be before the first event.');
  }
  const gen = occurrenceTimes(f, input.rule, until);
  if (!gen.ok) return refused(gen.message);
  // Store the last real occurrence, not the typed bound, so the series end
  // date matches what later splits and deletes compute.
  const lastUntil = isoDate(gen.times[gen.times.length - 1].startsAt);
  return withTxRetry(db, async (tx) => {
    const limited = await checkAddRateLimit(tx, userId);
    if (limited) return limited;
    const [s] = await tx
      .insert(eventSeries)
      .values({ rule: input.rule, until: lastUntil, createdBy: userId });
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
        until: lastUntil,
        count: gen.times.length,
        fields: jsonFields(f),
      },
    });
    await upsertSeries(tx, seriesId);
    return {
      ok: true,
      message: `Added a series (${gen.times.length} events).`,
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
    .set({ deletedAt: null, version: bumpSeries })
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
  opts: VersionOpts = {},
): Promise<ActionResult> {
  const seriesId = row.seriesId as number;
  return withTxRetry(db, async (tx) => {
    // Every series write locks the series row first, so the occurrences read
    // after it are current; the plan is rebuilt on every attempt.
    const [series] = await tx
      .select()
      .from(eventSeries)
      .where(eq(eventSeries.id, seriesId))
      .for('update');
    if (!series) return refused(NOT_FOUND);
    const stale = await checkExpectedVersion(tx, row.id, opts);
    if (stale) return stale;
    const all = await liveOccurrences(tx, seriesId).for('update');
    const idx = all.findIndex((e) => e.id === row.id);
    if (idx < 0) return refused(NOT_FOUND);
    const curTarget = rowFields(all[idx]);
    const vt = await validatePatch(tx, curTarget, patch);
    if (!vt.ok) return refused(vt.message);
    const nextTarget = vt.fields;
    const targets = scope === 'following' ? all.slice(idx) : [all[idx]];
    const plan: {
      row: EventRow;
      changes: ReturnType<typeof diffFields>;
      next: Fields;
    }[] = [];
    for (const t of targets) {
      let next = nextTarget;
      if (t.id !== row.id) {
        const f = await followingFields(tx, t, patch, curTarget, nextTarget);
        if (!f.ok) return refused(f.message);
        next = f.fields;
      }
      plan.push({ row: t, changes: diffFields(rowFields(t), next), next });
    }
    if (!plan.some((p) => Object.keys(p.changes).length > 0)) {
      // Saving unchanged retries a post that never got made.
      if (series.topicId === null) await upsertSeries(tx, seriesId);
      return { ok: true, message: 'No changes.' };
    }
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
          version: bumpEvent,
        })
        .where(and(eq(events.id, p.row.id), isNull(events.deletedAt)));
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
    await tx
      .update(eventSeries)
      .set({ version: bumpSeries })
      .where(inArray(eventSeries.id, touched));
    for (const id of touched) await upsertSeries(tx, id);
    return { ok: true, message: 'Changes saved.' };
  });
}

export async function deleteInSeries(
  db: Db,
  userId: number,
  row: EventRow,
  source: EventSource,
  scope: Scope,
  opts: VersionOpts = {},
): Promise<ActionResult> {
  const seriesId = row.seriesId as number;
  return withTxRetry(db, async (tx) => {
    await tx
      .select({ id: eventSeries.id })
      .from(eventSeries)
      .where(eq(eventSeries.id, seriesId))
      .for('update');
    const stale = await checkExpectedVersion(tx, row.id, opts);
    if (stale) return stale;
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
      .set({
        deletedAt: now,
        updatedBy: userId,
        updatedAt: now,
        version: bumpEvent,
      })
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
        .set({ deletedAt: now, version: bumpSeries })
        .where(eq(eventSeries.id, seriesId));
      await archiveSeries(tx, seriesId);
    } else {
      await tx
        .update(eventSeries)
        .set({
          until: isoDate(left[left.length - 1].startsAt),
          version: bumpSeries,
        })
        .where(eq(eventSeries.id, seriesId));
      await upsertSeries(tx, seriesId);
    }
    return {
      ok: true,
      message: scope === 'following' ? 'Events deleted.' : 'Event deleted.',
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
  return withTxRetry(db, async (tx) => {
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
    if (!t) return refused('Post not found.');
    if (subj.subjectId !== null && t.subjectId !== subj.subjectId) {
      return refused('This post belongs to a different subject.');
    }
    const links = await tx
      .select({ topicId: eventTopics.topicId })
      .from(eventTopics)
      .where(eq(eventTopics.seriesId, seriesId));
    if (links.some((l) => l.topicId === topicId)) {
      return refused('This post is already linked.');
    }
    if (links.length >= MAX_EVENT_LINKS) {
      return refused(`You can link at most ${MAX_EVENT_LINKS} posts.`);
    }
    await tx.insert(eventTopics).values({ seriesId, topicId });
    await tx
      .update(eventSeries)
      .set({ version: bumpSeries })
      .where(eq(eventSeries.id, seriesId));
    await writeAudit(tx, {
      userId,
      action: 'event.link',
      target: `series:${seriesId}`,
      details: { source, topicId },
    });
    await upsertSeries(tx, seriesId);
    return { ok: true, message: 'Post linked.' };
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
  return withTxRetry(db, async (tx) => {
    const [res] = await tx
      .delete(eventTopics)
      .where(
        and(
          eq(eventTopics.seriesId, seriesId),
          eq(eventTopics.topicId, topicId),
        ),
      );
    if (res.affectedRows === 0) return refused('This post is not linked.');
    await tx
      .update(eventSeries)
      .set({ version: bumpSeries })
      .where(eq(eventSeries.id, seriesId));
    await writeAudit(tx, {
      userId,
      action: 'event.unlink',
      target: `series:${seriesId}`,
      details: { source, topicId },
    });
    await upsertSeries(tx, seriesId);
    return { ok: true, message: 'Link removed.' };
  });
}

/**
 * `evt` interactions: the "Dodaj wydarzenie" modal, the event card and its
 * pickers. Mutations go through the shared `@studies/db` event actions, which
 * refuse banned users, audit with `source: 'discord'` and queue the post.
 */
import {
  addEvent,
  BANNED_MESSAGE,
  classes,
  classGroups,
  deleteEvent,
  type EventDetails,
  editEvent,
  eventMaterials,
  getEvent,
  linkTopic,
  subjects,
  topics,
  unlinkTopic,
  users,
} from '@studies/db';
import { EVENT_KIND_KEYS, type EventKind } from '@studies/db/constants';
import { and, count, desc, eq, isNull, ne } from 'drizzle-orm';
import { memberRoleIds, syncAdminFlag } from '../admin-flag.js';
import type { RouterDeps } from '../commands/router.js';
import { toDiscordUser } from '../discord/map.js';
import { RULE_LABELS } from '../events/posts.js';
import { MAX_OPTIONS } from './limits.js';
import {
  ack,
  ephemeral,
  fromEphemeral,
  STALE_TEXT,
  show,
  type UiInteraction,
} from './respond.js';
import {
  deleteConfirm,
  type EventCardData,
  eventCard,
  eventModal,
  linkView,
  type ModalCurrent,
  placementView,
  type Scope,
  SUBJECT_NONE,
  scopeChoice,
  whenInput,
} from './views/events.js';
import { notice, type View } from './views/student.js';

const attempt = <T>(f: () => T): T | null => {
  try {
    return f();
  } catch {
    return null;
  }
};

const ID_RE = /^[1-9]\d*$/;
const PAGE_RE = /^\d+$/;
const VERSION_RE = /^v\d+$/;
export const NOT_FOUND_TEXT = 'Nie znaleziono wydarzenia.';
export const DELETED_TEXT = 'Wydarzenie usunięte';

type Action =
  | { kind: 'new' }
  | { kind: 'open'; id: number }
  | { kind: 'show'; id: number }
  | { kind: 'edit'; id: number; scope: Scope | null }
  | { kind: 'save'; id: number | null; scope: Scope; version: number | null }
  | { kind: 'grpOpen'; id: number }
  | { kind: 'grpSet'; id: number; value: string }
  | { kind: 'linkOpen'; id: number; page: number }
  | { kind: 'linkToggle'; id: number; page: number; topicId: number }
  | { kind: 'del'; id: number; scope: Scope | null }
  | { kind: 'delok'; id: number; scope: Scope; version: number | null };

type Via = 'button' | 'select' | 'modal';

/** The action an `evt` id stands for; null for an id this bot does not build. */
export function parseEventAction(
  name: string,
  args: string[],
  via: Via,
  values: readonly string[],
): Action | null {
  const [a, b, c] = args;
  const id = a !== undefined && ID_RE.test(a) ? Number(a) : null;
  // An optional trailing scope; anything else is a stale id.
  const scopeArg =
    b === undefined ? null : b === 'one' || b === 'following' ? b : false;
  // An optional `v<version>` after the scope; anything else is a stale id.
  const version =
    c === undefined ? null : VERSION_RE.test(c) ? Number(c.slice(1)) : false;
  const value = values[0];
  switch (name) {
    case 'new':
      return via === 'button' ? { kind: 'new' } : null;
    case 'open':
      return via === 'select' && value !== undefined && ID_RE.test(value)
        ? { kind: 'open', id: Number(value) }
        : null;
    case 'save':
      if (via !== 'modal') return null;
      if (scopeArg === false || version === false) return null;
      if (a === 'new') {
        return { kind: 'save', id: null, scope: 'one', version: null };
      }
      return id === null
        ? null
        : { kind: 'save', id, scope: scopeArg ?? 'one', version };
  }
  if (id === null) return null;
  switch (name) {
    case 'show':
      return via === 'button' ? { kind: 'show', id } : null;
    case 'edit':
      return via === 'button' && scopeArg !== false
        ? { kind: 'edit', id, scope: scopeArg }
        : null;
    case 'del':
      return via === 'button' && scopeArg !== false
        ? { kind: 'del', id, scope: scopeArg }
        : null;
    case 'delok':
      return via === 'button' && scopeArg !== false && version !== false
        ? { kind: 'delok', id, scope: scopeArg ?? 'one', version }
        : null;
    case 'grp':
      if (via === 'button') return { kind: 'grpOpen', id };
      return via === 'select' && value !== undefined
        ? { kind: 'grpSet', id, value }
        : null;
    case 'link': {
      const page = b === undefined ? 0 : PAGE_RE.test(b) ? Number(b) : null;
      if (page === null) return null;
      if (via === 'button') return { kind: 'linkOpen', id, page };
      return via === 'select' && value !== undefined && ID_RE.test(value)
        ? { kind: 'linkToggle', id, page, topicId: Number(value) }
        : null;
    }
  }
  return null;
}

/** Event card data from the DB; null when the event is gone. */
export async function loadCardData(
  deps: Pick<RouterDeps, 'ingest' | 'config'>,
  id: number,
): Promise<{ e: EventDetails; data: EventCardData } | null> {
  const { db } = deps.ingest;
  const e = await getEvent(db, id);
  if (!e) return null;
  let placement: string | null = null;
  if (e.groupId !== null) {
    const [r] = await db
      .select({ c: classes.name, g: classGroups.name })
      .from(classGroups)
      .innerJoin(classes, eq(classes.id, classGroups.classId))
      .where(eq(classGroups.id, e.groupId));
    if (r) placement = `${r.c} · ${r.g}`;
  } else if (e.classId !== null) {
    const [r] = await db
      .select({ c: classes.name })
      .from(classes)
      .where(eq(classes.id, e.classId));
    if (r) placement = r.c;
  }
  let postUrl: string | null = null;
  const postTopicId = e.series ? e.series.topicId : e.topicId;
  if (postTopicId !== null && deps.config.discordGuildId) {
    const [t] = await db
      .select({ thread: topics.discordThreadId })
      .from(topics)
      .where(and(eq(topics.id, postTopicId), isNull(topics.deletedAt)));
    if (t) {
      postUrl = `https://discord.com/channels/${deps.config.discordGuildId}/${t.thread}`;
    }
  }
  const mats = await eventMaterials(db, id);
  return {
    e,
    data: {
      id: e.id,
      kind: e.kind,
      title: e.title,
      subjectCode: e.subjectCode,
      subjectName: e.subjectName,
      placement,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      allDay: e.allDay,
      place: e.place,
      note: e.note,
      createdByName: e.createdByName,
      updatedByName: e.updatedByName,
      materials: mats.map((m) => ({
        id: m.id,
        filename: m.filename,
        previewKind: m.previewKind,
      })),
      webBaseUrl: deps.config.webBaseUrl,
      postUrl,
      seriesLabel: e.series ? RULE_LABELS[e.series.rule] : null,
    },
  };
}

/** The card, or a notice when the event is deleted or missing. */
export async function cardView(
  deps: Pick<RouterDeps, 'ingest' | 'config'>,
  id: number,
): Promise<View> {
  const c = await loadCardData(deps, id);
  if (!c) return notice(NOT_FOUND_TEXT);
  if (c.e.deletedAt) return notice(DELETED_TEXT);
  return eventCard(c.data);
}

const modalSubjects = (db: RouterDeps['ingest']['db']) =>
  db
    .select({ code: subjects.code, name: subjects.name })
    .from(subjects)
    .orderBy(subjects.semester, subjects.code);

/** Splits "Miejsce / notatka": the first line is the place, the rest the note. */
export function splitPlaceNote(s: string): {
  place: string | null;
  note: string | null;
} {
  const t = s.replace(/\r\n/g, '\n');
  const nl = t.indexOf('\n');
  const place = (nl < 0 ? t : t.slice(0, nl)).trim();
  const note = nl < 0 ? '' : t.slice(nl + 1).trim();
  return { place: place || null, note: note || null };
}

export async function handleEvent(
  deps: RouterDeps,
  i: UiInteraction,
  name: string,
  args: string[],
): Promise<void> {
  const via: Via = i.isModalSubmit()
    ? 'modal'
    : i.isStringSelectMenu()
      ? 'select'
      : 'button';
  const values = i.isStringSelectMenu() ? i.values : [];
  const action = parseEventAction(name, args, via, values);
  if (!action) return void (await i.reply(ephemeral(notice(STALE_TEXT))));

  const { db } = deps.ingest;

  if (action.kind === 'new' || action.kind === 'edit') {
    if (i.isModalSubmit()) return;
    // The modal must be the first response: only the ban check and the one
    // read it needs, no admin-flag sync.
    const [u] = await db
      .select({ banned: users.isBanned })
      .from(users)
      .where(eq(users.discordUserId, i.user.id));
    if (u?.banned) {
      return void (await i.reply(ephemeral(notice(BANNED_MESSAGE))));
    }
    let cur: ModalCurrent | undefined;
    let id: number | null = null;
    let version: number | undefined;
    if (action.kind === 'edit') {
      const e = await getEvent(db, action.id);
      if (!e || e.deletedAt) {
        return void (await i.reply(
          ephemeral(notice(e ? DELETED_TEXT : NOT_FOUND_TEXT)),
        ));
      }
      if (e.series && action.scope === null) {
        await ack(i);
        return show(i, scopeChoice('edit', e.id, e.title));
      }
      id = e.id;
      version = e.version;
      cur = {
        kind: e.kind,
        title: e.title,
        subjectCode: e.subjectCode,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        allDay: e.allDay,
        place: e.place,
        note: e.note,
      };
    }
    await i.showModal(
      eventModal(
        id,
        await modalSubjects(db),
        cur,
        action.kind === 'edit' ? (action.scope ?? undefined) : undefined,
        version,
      ),
    );
    return;
  }

  // Saving a new event or opening one from a plan answers with a message of
  // its own; everything else updates the private view it came from.
  const fresh =
    action.kind === 'open' || (action.kind === 'save' && !action.id);
  const inPlace = !fresh && fromEphemeral(i);
  await ack(i, fresh);
  const { userId } = await syncAdminFlag(
    db,
    toDiscordUser(i.user, i.member),
    memberRoleIds(i),
  );
  const [u] = await db
    .select({ banned: users.isBanned })
    .from(users)
    .where(eq(users.id, userId));
  if (u?.banned) return show(i, notice(BANNED_MESSAGE));
  /** An error next to the view that stays, or in place of a fresh reply. */
  const fail = async (message: string) => {
    if (inPlace) await i.followUp(ephemeral(notice(message)));
    else await show(i, notice(message));
  };
  const showCard = async (id: number) => show(i, await cardView(deps, id));

  switch (action.kind) {
    case 'open':
    case 'show':
      return showCard(action.id);

    case 'save': {
      if (!i.isModalSubmit()) return;
      const [kind] = i.fields.getStringSelectValues('kind');
      if (!(EVENT_KIND_KEYS as readonly string[]).includes(kind ?? '')) {
        return fail(STALE_TEXT);
      }
      let subjectId: number | null = null;
      // Whichever component the modal had: the select, else the code field.
      const picked = attempt(() => i.fields.getStringSelectValues('subject'));
      const chosen = picked?.length
        ? picked[0]
        : (attempt(() => i.fields.getTextInputValue('subject')) ?? '')
            .trim()
            .toUpperCase() || null;
      if (chosen !== null && chosen !== SUBJECT_NONE) {
        const [s] = await db
          .select({ id: subjects.id })
          .from(subjects)
          .where(eq(subjects.code, chosen));
        if (!s) return fail(`Nie znaleziono przedmiotu o kodzie ${chosen}.`);
        subjectId = s.id;
      }
      const { place, note } = splitPlaceNote(
        i.fields.getTextInputValue('place_note'),
      );
      const input = {
        kind: kind as EventKind,
        title: i.fields.getTextInputValue('title'),
        subjectId,
        when: i.fields.getTextInputValue('when'),
        place,
        note,
      };
      if (action.id === null) {
        const r = await addEvent(db, userId, input, 'discord');
        if (!r.ok || r.id === undefined) return fail(r.message);
        return showCard(r.id);
      }
      // Only what differs from the prefilled values: an unchanged "Kiedy" is
      // not range-checked again, an unchanged submit is a no-op.
      const e = await getEvent(db, action.id);
      if (!e || e.deletedAt) return fail(e ? DELETED_TEXT : NOT_FOUND_TEXT);
      const patch: Partial<typeof input> = {};
      if (input.kind !== e.kind) patch.kind = input.kind;
      if (input.title !== e.title) patch.title = input.title;
      if (input.subjectId !== e.subjectId) patch.subjectId = input.subjectId;
      if (input.when.trim() !== whenInput(e.startsAt, e.endsAt, e.allDay)) {
        patch.when = input.when;
      }
      if (input.place !== (e.place?.trim() || null)) patch.place = input.place;
      if (input.note !== (e.note?.trim() || null)) patch.note = input.note;
      const r = await editEvent(
        db,
        userId,
        action.id,
        patch,
        'discord',
        action.scope,
        action.version === null ? {} : { expectedVersion: action.version },
      );
      if (!r.ok) return fail(r.message);
      return showCard(action.id);
    }

    case 'grpOpen': {
      const e = await getEvent(db, action.id);
      if (!e || e.deletedAt || e.subjectId === null) {
        return fail(e?.deletedAt ? DELETED_TEXT : NOT_FOUND_TEXT);
      }
      const cs = await db
        .select({ id: classes.id, name: classes.name })
        .from(classes)
        .where(eq(classes.subjectId, e.subjectId))
        .orderBy(classes.id);
      const gs = await db
        .select({
          id: classGroups.id,
          classId: classGroups.classId,
          name: classGroups.name,
        })
        .from(classGroups)
        .innerJoin(classes, eq(classes.id, classGroups.classId))
        .where(eq(classes.subjectId, e.subjectId))
        .orderBy(classGroups.number);
      return show(
        i,
        placementView(
          e.id,
          e.title,
          cs.map((c) => ({
            classId: c.id,
            className: c.name,
            groups: gs.filter((g) => g.classId === c.id),
          })),
          { classId: e.classId, groupId: e.groupId },
        ),
      );
    }

    case 'grpSet': {
      const v = action.value;
      let patch: { classId: number | null; groupId: number | null } | null =
        null;
      if (v === '0') patch = { classId: null, groupId: null };
      else if (/^c[1-9]\d*$/.test(v)) {
        patch = { classId: Number(v.slice(1)), groupId: null };
      } else if (/^g[1-9]\d*$/.test(v)) {
        const [g] = await db
          .select({ classId: classGroups.classId })
          .from(classGroups)
          .where(eq(classGroups.id, Number(v.slice(1))));
        if (g) patch = { classId: g.classId, groupId: Number(v.slice(1)) };
      }
      if (!patch) return fail(STALE_TEXT);
      const r = await editEvent(db, userId, action.id, patch, 'discord');
      if (!r.ok) await fail(r.message);
      return showCard(action.id);
    }

    case 'linkOpen':
    case 'linkToggle': {
      const msg =
        action.kind === 'linkToggle'
          ? await toggleLink(deps, userId, action.id, action.topicId)
          : null;
      const v = await linkPage(deps, action.id, action.page);
      await show(i, v);
      if (msg && !msg.ok) await i.followUp(ephemeral(notice(msg.message)));
      return;
    }

    case 'del': {
      const e = await getEvent(db, action.id);
      if (!e || e.deletedAt) return fail(e ? DELETED_TEXT : NOT_FOUND_TEXT);
      if (e.series && action.scope === null) {
        return show(i, scopeChoice('del', e.id, e.title));
      }
      return show(
        i,
        deleteConfirm(
          e.id,
          e.title,
          e.series ? (action.scope ?? 'one') : undefined,
          e.version,
        ),
      );
    }

    case 'delok': {
      const r = await deleteEvent(
        db,
        userId,
        action.id,
        'discord',
        action.scope,
        action.version === null ? {} : { expectedVersion: action.version },
      );
      return show(i, notice(r.ok ? DELETED_TEXT : r.message));
    }
  }
}

async function toggleLink(
  deps: RouterDeps,
  userId: number,
  eventId: number,
  topicId: number,
) {
  const { db } = deps.ingest;
  const e = await getEvent(db, eventId);
  if (!e || e.deletedAt) return { ok: false, message: NOT_FOUND_TEXT };
  return e.linkedTopicIds.includes(topicId)
    ? unlinkTopic(db, userId, eventId, topicId, 'discord')
    : linkTopic(db, userId, eventId, topicId, 'discord');
}

async function linkPage(
  deps: RouterDeps,
  eventId: number,
  requested: number,
): Promise<View> {
  const { db } = deps.ingest;
  const e = await getEvent(db, eventId);
  if (!e || e.deletedAt) return notice(e ? DELETED_TEXT : NOT_FOUND_TEXT);
  if (e.subjectId === null) return notice('Wydarzenie nie ma przedmiotu.');
  const where = and(
    eq(topics.subjectId, e.subjectId),
    isNull(topics.deletedAt),
    (e.series ? e.series.topicId : e.topicId) === null
      ? undefined
      : ne(topics.id, (e.series ? e.series.topicId : e.topicId) as number),
  );
  const [{ n }] = await db.select({ n: count() }).from(topics).where(where);
  const pages = Math.max(1, Math.ceil(n / MAX_OPTIONS));
  const page = Math.min(requested, pages - 1);
  const rows = await db
    .select({ id: topics.id, title: topics.title })
    .from(topics)
    .where(where)
    .orderBy(desc(topics.id))
    .limit(MAX_OPTIONS)
    .offset(page * MAX_OPTIONS);
  return linkView(
    e.id,
    e.title,
    rows.map((t) => ({
      id: t.id,
      title: t.title,
      linked: e.linkedTopicIds.includes(t.id),
    })),
    page,
    pages,
    e.linkedTopicIds.length,
  );
}

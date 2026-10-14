/**
 * Admin panel actions (`adm` ids): parsing a decoded id into an action, the
 * admin check (re-run on every interaction), and running the action.
 *
 * Modals are opened as the first response; everything else is acknowledged
 * before its DB work. Changes go through the same `@studies/db` actions as the
 * slash commands and are audited the same way.
 */
import {
  ASSESSMENTS,
  type Assessment,
  addLecturer,
  addSubject,
  assignLecturer,
  banUser,
  CLASS_KINDS,
  type ClassKind,
  type Db,
  editClass,
  editLecturer,
  editSubject,
  upsertUser,
} from '@studies/db';
import type { ModalBuilder } from 'discord.js';
import { memberRoleIds, syncAdminFlag } from '../admin-flag.js';
import { auditDiscord } from '../audit.js';
import {
  ECTS_MAX,
  ECTS_MIN,
  FIELD_MAX,
  SEMESTERS,
} from '../commands/fields.js';
import { planSyncReply } from '../commands/plan.js';
import type { RouterDeps } from '../commands/router.js';
import {
  LINK_BANNED,
  LINK_DM_CLOSED,
  LINK_SENT,
  linkFor,
  sendLoginDm,
} from '../commands/student.js';
import { toDiscordUser } from '../discord/map.js';
import {
  type Audit,
  BUSY_TEXT,
  runResync,
  runSetup,
  withSetupLock,
} from '../ops.js';
import {
  classRow,
  groupOptions,
  lecturerOptions,
  lecturerRow,
  loadStatus,
  subjectCardData,
  subjectOptions,
  subjectRow,
  userCardData,
} from './admin-data.js';
import {
  ack,
  ephemeral,
  STALE_TEXT,
  show,
  type UiInteraction,
} from './respond.js';
import {
  assignPicker,
  banConfirm,
  classActions,
  lecturerCard,
  lecturerPicker,
  reportView,
  setupConfirm,
  statusCard,
  subjectCard,
  subjectPicker,
  userCard,
  userPicker,
} from './views/admin.js';
import {
  classModal,
  lecturerModal,
  prefill,
  subjectModal,
} from './views/modals.js';
import { notice, type View } from './views/parts.js';

export const NO_PERMISSION = 'Brak uprawnień.';
export const WORKING = 'Pracuję…';
export const SEMESTER_TEXT = 'Semestr musi wynosić 1 lub 2.';
export const ECTS_TEXT = 'ECTS musi być liczbą od 0 do 30.';
export const CODE_TEXT =
  'Kod może zawierać tylko litery, cyfry, kropkę, myślnik i podkreślenie (do 20 znaków).';
export const EMPTY_NAME = 'Nazwa nie może być pusta.';
export const SELF_BAN = 'Nie możesz zablokować siebie.';
const UNRENDERABLE =
  'Tego przedmiotu nie da się pokazać w panelu: jego kod zawiera niedozwolone znaki. Zmień go na stronie.';

const CODE_RE = /^[A-Za-z0-9._-]{1,20}$/;
const ID_RE = /^[1-9]\d*$/;
const NUM_RE = /^\d+$/;
const PAGE_RE = /^-?\d+$/;
const SNOWFLAKE_RE = /^\d{1,20}$/;

/* ---------- parsing ---------- */

type Via = 'button' | 'select' | 'userSelect' | 'modal';

export type AdminAction =
  | { kind: 'status' }
  | { kind: 'planSync' }
  | { kind: 'resync' }
  | { kind: 'setupAsk' }
  | { kind: 'setup'; dryRun: boolean }
  | { kind: 'web' }
  | { kind: 'subjList'; page: number }
  | { kind: 'subjPick'; code: string }
  | { kind: 'subjAdd' }
  | { kind: 'subjEdit'; code: string }
  | { kind: 'subjSave'; code: string | null }
  | { kind: 'classPick'; code: string; classKind: ClassKind }
  | { kind: 'classEdit'; code: string; classKind: ClassKind }
  | { kind: 'classSave'; code: string; classKind: ClassKind }
  | { kind: 'assignStart'; code: string; classKind: ClassKind; page: number }
  | {
      kind: 'assignLect';
      code: string;
      classKind: ClassKind;
      lecturerId: number;
    }
  | {
      kind: 'assignGroup';
      code: string;
      classKind: ClassKind;
      lecturerId: number;
      /** 0 = the whole class. */
      group: number;
    }
  | { kind: 'lectList'; page: number }
  | { kind: 'lectPick'; id: number }
  | { kind: 'lectAdd' }
  | { kind: 'lectEdit'; id: number }
  | { kind: 'lectSave'; id: number | null }
  | { kind: 'userOpen' }
  | { kind: 'userPick'; target: string }
  | { kind: 'userConfirm'; target: string; ban: boolean }
  | { kind: 'userSet'; target: string; ban: boolean };

const isKind = (s: string | undefined): s is ClassKind =>
  s !== undefined && (CLASS_KINDS as readonly string[]).includes(s);

/**
 * The action an `adm` id stands for, given how it arrived (`via`) and a
 * select's values; null when this bot never builds such an id (stale).
 */
export function parseAdminAction(
  action: string,
  args: string[],
  via: Via,
  values: readonly string[],
): AdminAction | null {
  const [a, b, c, d] = args;
  const v = values[0];
  const button = via === 'button';
  switch (action) {
    case 'status':
    case 'resync':
    case 'web':
      return button && args.length === 0 ? { kind: action } : null;
    case 'plan':
      return button && a === 'sync' ? { kind: 'planSync' } : null;
    case 'setup':
      if (!button) return null;
      if (a === 'ask') return { kind: 'setupAsk' };
      if (a === 'dry' || a === 'run')
        return { kind: 'setup', dryRun: a === 'dry' };
      return null;
    case 'subj':
      if (a === 'list' && button && PAGE_RE.test(b ?? ''))
        return { kind: 'subjList', page: Number(b) };
      if (a === 'pick' && via === 'select' && v)
        return { kind: 'subjPick', code: v };
      if (a === 'add' && button) return { kind: 'subjAdd' };
      if (a === 'edit' && button && b) return { kind: 'subjEdit', code: b };
      if (a === 'save' && via === 'modal' && b)
        return { kind: 'subjSave', code: b === 'new' ? null : b };
      return null;
    case 'class':
      if (!b) return null;
      if (a === 'pick' && via === 'select' && isKind(v))
        return { kind: 'classPick', code: b, classKind: v };
      if (a === 'edit' && button && isKind(c))
        return { kind: 'classEdit', code: b, classKind: c };
      if (a === 'save' && via === 'modal' && isKind(c))
        return { kind: 'classSave', code: b, classKind: c };
      return null;
    case 'assign':
      if (!b || !isKind(c)) return null;
      if (a === 'start' && button && (d === undefined || PAGE_RE.test(d)))
        return {
          kind: 'assignStart',
          code: b,
          classKind: c,
          page: d === undefined ? 0 : Number(d),
        };
      if (a === 'lect' && via === 'select' && ID_RE.test(v ?? ''))
        return {
          kind: 'assignLect',
          code: b,
          classKind: c,
          lecturerId: Number(v),
        };
      if (
        a === 'grp' &&
        via === 'select' &&
        ID_RE.test(d ?? '') &&
        NUM_RE.test(v ?? '')
      )
        return {
          kind: 'assignGroup',
          code: b,
          classKind: c,
          lecturerId: Number(d),
          group: Number(v),
        };
      return null;
    case 'lect':
      if (a === 'list' && button && PAGE_RE.test(b ?? ''))
        return { kind: 'lectList', page: Number(b) };
      if (a === 'pick' && via === 'select' && ID_RE.test(v ?? ''))
        return { kind: 'lectPick', id: Number(v) };
      if (a === 'add' && button) return { kind: 'lectAdd' };
      if (a === 'edit' && button && ID_RE.test(b ?? ''))
        return { kind: 'lectEdit', id: Number(b) };
      if (
        a === 'save' &&
        via === 'modal' &&
        (b === 'new' || ID_RE.test(b ?? ''))
      )
        return { kind: 'lectSave', id: b === 'new' ? null : Number(b) };
      return null;
    case 'user':
      if (a === 'open' && button) return { kind: 'userOpen' };
      if (a === 'pick' && via === 'userSelect' && SNOWFLAKE_RE.test(v ?? ''))
        return { kind: 'userPick', target: v };
      if (!button || !SNOWFLAKE_RE.test(b ?? '')) return null;
      if (a === 'ban' || a === 'unban')
        return { kind: 'userConfirm', target: b, ban: a === 'ban' };
      if (a === 'banok' || a === 'unbanok')
        return { kind: 'userSet', target: b, ban: a === 'banok' };
      return null;
  }
  return null;
}

/* ---------- running ---------- */

interface Ctx {
  deps: RouterDeps;
  db: Db;
  i: UiInteraction;
  audit: Audit;
}

/** A view built from a stored subject code; a code that can't go into an id
 * (e.g. one with ":" set on the web) gives a notice instead. */
function safe(build: () => View): View {
  try {
    return build();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('encodeId')) {
      console.error('admin panel: cannot render', err.message);
      return notice(UNRENDERABLE);
    }
    throw err;
  }
}

/** A private notice as the first response (nothing acknowledged yet). */
const reply = (i: UiInteraction, text: string) =>
  i.reply(ephemeral(notice(text)));
/** A private notice next to the acknowledged view, which stays as it is. */
const say = (i: UiInteraction, text: string) =>
  i.followUp(ephemeral(notice(text)));

/** Opens a modal as the first response. */
async function openModal(
  i: UiInteraction,
  build: () => ModalBuilder,
): Promise<void> {
  if (i.isModalSubmit()) throw new Error('a modal cannot open a modal');
  let m: ModalBuilder;
  try {
    m = build();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('encodeId')) {
      console.error('admin panel: cannot build modal', err.message);
      await reply(i, UNRENDERABLE);
      return;
    }
    throw err;
  }
  await i.showModal(m);
}

const textField = (i: UiInteraction, id: string) =>
  i.isModalSubmit() ? i.fields.getTextInputValue(id) : '';

function parseSemester(s: string): 1 | 2 | null {
  const t = s.trim();
  if (!NUM_RE.test(t)) return null;
  const n = Number(t);
  return (SEMESTERS as readonly number[]).includes(n) ? (n as 1 | 2) : null;
}

function parseEcts(s: string): number | null {
  const t = s.trim();
  if (!NUM_RE.test(t)) return null;
  const n = Number(t);
  return n >= ECTS_MIN && n <= ECTS_MAX ? n : null;
}

async function showSubject(ctx: Ctx, code: string): Promise<void> {
  const data = await subjectCardData(ctx.db, code);
  await show(
    ctx.i,
    data
      ? safe(() => subjectCard(data))
      : notice(`Nie znaleziono przedmiotu ${code}.`),
  );
}

async function showLecturer(ctx: Ctx, id: number): Promise<void> {
  const l = await lecturerRow(ctx.db, id);
  await show(
    ctx.i,
    l ? lecturerCard(l) : notice(`Nie znaleziono prowadzącego o id ${id}.`),
  );
}

/** setup / resync: "Pracuję…", then the report, under the /setup lock. */
async function longRun(
  ctx: Ctx,
  title: string,
  run: () => Promise<string>,
): Promise<void> {
  await ack(ctx.i);
  await show(ctx.i, notice(WORKING));
  const result = await withSetupLock(run);
  await show(
    ctx.i,
    result === 'busy'
      ? notice(BUSY_TEXT)
      : reportView(title, result, ['status']),
  );
}

async function saveSubject(ctx: Ctx, code: string | null): Promise<void> {
  const { i, db } = ctx;
  const name = textField(i, 'name').trim();
  if (!name) return void (await reply(i, EMPTY_NAME));
  const newCode = code === null ? textField(i, 'code').trim() : null;
  if (newCode !== null && !CODE_RE.test(newCode))
    return void (await reply(i, CODE_TEXT));
  const semester = parseSemester(textField(i, 'semester'));
  if (semester === null) return void (await reply(i, SEMESTER_TEXT));
  const ects = parseEcts(textField(i, 'ects'));
  if (ects === null) return void (await reply(i, ECTS_TEXT));
  const description = textField(i, 'description');

  await ack(i);
  if (newCode !== null) {
    const r = await addSubject(db, {
      channelId: null,
      name,
      code: newCode,
      semester,
      ects,
      description: description.trim() || undefined,
    });
    if (!r.ok) return void (await say(i, r.message));
    await ctx.audit('subject.add', newCode.toUpperCase(), { channelId: null });
    await show(
      i,
      reportView(
        'Nowy przedmiot',
        `${r.message}\nUruchom /setup, aby utworzyć jego forum.`,
        ['setup'],
      ),
    );
    return;
  }

  const cur = await subjectRow(db, code as string);
  if (!cur) return void (await say(i, `Nie znaleziono przedmiotu ${code}.`));
  // Only what was changed: an untouched (possibly clipped) prefill is kept.
  const patch: Parameters<typeof editSubject>[2] = {};
  if (name !== cur.name) patch.name = name;
  if (semester !== cur.semester) patch.semester = semester;
  if (ects !== cur.ects) patch.ects = ects;
  if (description !== prefill(cur.description, FIELD_MAX.description))
    patch.description = description.trim() || null;
  const url = textField(i, 'platform_url');
  if (url !== prefill(cur.platformUrl, FIELD_MAX.platformUrl))
    patch.platformUrl = url;
  const fields = Object.keys(patch);
  if (fields.length) {
    const r = await editSubject(db, cur.code, patch);
    if (!r.ok) return void (await say(i, r.message));
    await ctx.audit('subject.edit', cur.code, { fields });
  }
  await showSubject(ctx, cur.code);
}

async function saveClass(
  ctx: Ctx,
  code: string,
  kind: ClassKind,
): Promise<void> {
  const { i, db } = ctx;
  const [assessment] = i.isModalSubmit()
    ? i.fields.getStringSelectValues('assessment')
    : [];
  if (
    assessment !== 'brak' &&
    !(ASSESSMENTS as readonly string[]).includes(assessment ?? '')
  )
    return void (await reply(i, STALE_TEXT));

  await ack(i);
  const cur = await classRow(db, code, kind);
  if (!cur) {
    // editClass with no changes only looks the class up: its refusal.
    const r = await editClass(db, { subjectCode: code, kind });
    return void (await say(i, r.message));
  }
  const input: {
    assessment?: Assessment | 'brak';
    note?: string;
    platformUrl?: string;
  } = {};
  if (assessment !== (cur.assessment ?? 'brak'))
    input.assessment = assessment as Assessment | 'brak';
  const note = textField(i, 'note');
  if (note !== prefill(cur.assessmentNote, FIELD_MAX.classNote))
    input.note = note;
  const url = textField(i, 'platform_url');
  if (url !== prefill(cur.platformUrl, FIELD_MAX.platformUrl))
    input.platformUrl = url;
  const fields = Object.keys(input);
  if (fields.length) {
    const r = await editClass(db, { subjectCode: code, kind, ...input });
    if (!r.ok) return void (await say(i, r.message));
    await ctx.audit('class.edit', code.trim().toUpperCase(), { kind, fields });
  }
  await showSubject(ctx, code);
}

const LECTURER_FIELDS = [
  ['title', 'title', FIELD_MAX.lecturerTitle],
  ['email', 'email', FIELD_MAX.email],
  ['officeHours', 'office_hours', FIELD_MAX.officeHours],
  ['room', 'room', FIELD_MAX.room],
] as const;

async function saveLecturer(ctx: Ctx, id: number | null): Promise<void> {
  const { i, db } = ctx;
  const name = textField(i, 'name').trim();
  if (!name) return void (await reply(i, EMPTY_NAME));
  await ack(i);
  if (id === null) {
    const input: Parameters<typeof addLecturer>[1] = { name };
    for (const [key, field] of LECTURER_FIELDS)
      input[key] = textField(i, field);
    const r = await addLecturer(db, input);
    if (!r.ok || r.id === undefined) return void (await say(i, r.message));
    await ctx.audit('lecturer.add', String(r.id), { name });
    await showLecturer(ctx, r.id);
    return;
  }
  const cur = await lecturerRow(db, id);
  if (!cur)
    return void (await say(i, `Nie znaleziono prowadzącego o id ${id}.`));
  const patch: Parameters<typeof editLecturer>[2] = {};
  if (name !== cur.name) patch.name = name;
  for (const [key, field, max] of LECTURER_FIELDS) {
    const v = textField(i, field);
    if (v !== prefill(cur[key], max)) patch[key] = v;
  }
  const fields = Object.keys(patch);
  if (fields.length) {
    const r = await editLecturer(db, id, patch);
    if (!r.ok) return void (await say(i, r.message));
    await ctx.audit('lecturer.edit', String(id), { fields });
  }
  await showLecturer(ctx, id);
}

async function setBan(ctx: Ctx, target: string, ban: boolean): Promise<void> {
  const { i, db, deps } = ctx;
  if (ban && target === i.user.id) return void (await reply(i, SELF_BAN));
  await ack(i);
  // As /ban: make sure the row exists so the ban applies even to someone who
  // never used the bot.
  await upsertUser(db, toDiscordUser(await deps.client.users.fetch(target)));
  const r = await banUser(db, target, ban);
  if (!r.ok) return void (await say(i, r.message));
  await ctx.audit(ban ? 'user.ban' : 'user.unban', target, {});
  await show(
    i,
    userCard(
      await userCardData(db, target, `<@${target}>`),
      target === i.user.id,
    ),
  );
}

async function run(ctx: Ctx, a: AdminAction): Promise<void> {
  const { i, db, deps } = ctx;
  switch (a.kind) {
    case 'status':
      await ack(i);
      return show(i, statusCard(await loadStatus(db)));
    case 'planSync': {
      await ack(i);
      const text = await planSyncReply(db, new Date());
      await ctx.audit('plan.sync', null, {});
      return show(i, reportView('Synchronizacja planu', text, ['status']));
    }
    case 'resync':
      return longRun(ctx, 'Pobieranie z Discorda', () =>
        runResync(deps, ctx.audit),
      );
    case 'setupAsk':
      await ack(i);
      return show(i, setupConfirm());
    case 'setup': {
      const guild = i.guild;
      if (!guild) throw new Error('admin panel outside a guild');
      return longRun(ctx, a.dryRun ? 'Podgląd /setup' : 'Wynik /setup', () =>
        runSetup(deps, guild, i.user.id, a.dryRun, ctx.audit),
      );
    }
    case 'web': {
      // A status message of its own: keep the panel it came from.
      await ack(i, true);
      const res = await linkFor(
        db,
        deps.config.webBaseUrl,
        toDiscordUser(i.user, i.member),
        '/admin',
      );
      if (!res.ok) return show(i, notice(LINK_BANNED));
      const sent = await sendLoginDm(i.user, res.url);
      return show(i, notice(sent ? LINK_SENT : LINK_DM_CLOSED));
    }
    case 'subjList':
      await ack(i);
      return show(i, subjectPicker(await subjectOptions(db), a.page));
    case 'subjPick':
      await ack(i);
      return showSubject(ctx, a.code);
    case 'subjAdd':
      return openModal(i, () => subjectModal());
    case 'subjEdit': {
      const s = await subjectRow(db, a.code);
      if (!s)
        return void (await reply(i, `Nie znaleziono przedmiotu ${a.code}.`));
      return openModal(i, () => subjectModal(s));
    }
    case 'subjSave':
      return saveSubject(ctx, a.code);
    case 'classPick':
      await ack(i);
      return show(
        i,
        safe(() => classActions(a.code, a.classKind)),
      );
    case 'classEdit': {
      const c = await classRow(db, a.code, a.classKind);
      if (!c) {
        const r = await editClass(db, {
          subjectCode: a.code,
          kind: a.classKind,
        });
        return void (await reply(i, r.message));
      }
      return openModal(i, () => classModal(a.code, a.classKind, c));
    }
    case 'classSave':
      return saveClass(ctx, a.code, a.classKind);
    case 'assignStart':
    case 'assignLect': {
      await ack(i);
      const [list, groups] = [
        await lecturerOptions(db),
        await groupOptions(db, a.code, a.classKind),
      ];
      return show(
        i,
        safe(() =>
          assignPicker(
            a.code,
            a.classKind,
            list,
            groups,
            a.kind === 'assignStart'
              ? { page: a.page }
              : { lecturerId: a.lecturerId },
          ),
        ),
      );
    }
    case 'assignGroup': {
      await ack(i);
      const groupNumber = a.group === 0 ? undefined : a.group;
      const r = await assignLecturer(db, {
        subjectCode: a.code,
        lecturerId: a.lecturerId,
        classKind: a.classKind,
        groupNumber,
      });
      if (!r.ok) return void (await say(i, r.message));
      await ctx.audit('lecturer.assign', a.code.trim().toUpperCase(), {
        lecturerId: a.lecturerId,
        classKind: a.classKind,
        groupNumber,
      });
      return showSubject(ctx, a.code);
    }
    case 'lectList':
      await ack(i);
      return show(i, lecturerPicker(await lecturerOptions(db), a.page));
    case 'lectPick':
      await ack(i);
      return showLecturer(ctx, a.id);
    case 'lectAdd':
      return openModal(i, () => lecturerModal());
    case 'lectEdit': {
      const l = await lecturerRow(db, a.id);
      if (!l)
        return void (await reply(
          i,
          `Nie znaleziono prowadzącego o id ${a.id}.`,
        ));
      return openModal(i, () => lecturerModal(l));
    }
    case 'lectSave':
      return saveLecturer(ctx, a.id);
    case 'userOpen':
      await ack(i);
      return show(i, userPicker());
    case 'userPick': {
      await ack(i);
      const picked = i.isUserSelectMenu() ? i.users.get(a.target) : undefined;
      const member = i.isUserSelectMenu() ? i.members.get(a.target) : undefined;
      const name = picked
        ? toDiscordUser(picked, member ?? null).displayName
        : `<@${a.target}>`;
      return show(
        i,
        userCard(
          await userCardData(db, a.target, name),
          a.target === i.user.id,
        ),
      );
    }
    case 'userConfirm': {
      if (a.ban && a.target === i.user.id)
        return void (await reply(i, SELF_BAN));
      await ack(i);
      const u = await userCardData(db, a.target, `<@${a.target}>`);
      return show(i, banConfirm(u, a.ban));
    }
    case 'userSet':
      return setBan(ctx, a.target, a.ban);
  }
}

/**
 * An `adm` interaction: stale ids get the stale notice, non-admins (by the
 * stored role, re-checked every time) "Brak uprawnień.", both before anything
 * else happens.
 */
export async function handleAdmin(
  deps: RouterDeps,
  i: UiInteraction,
  name: string,
  args: string[],
): Promise<void> {
  const via: Via = i.isModalSubmit()
    ? 'modal'
    : i.isUserSelectMenu()
      ? 'userSelect'
      : i.isStringSelectMenu()
        ? 'select'
        : 'button';
  const values = i.isStringSelectMenu() || i.isUserSelectMenu() ? i.values : [];
  const action = parseAdminAction(name, args, via, values);
  if (!action) return void (await reply(i, STALE_TEXT));

  const { db } = deps.ingest;
  const { isAdmin, userId } = await syncAdminFlag(
    db,
    toDiscordUser(i.user, i.member),
    memberRoleIds(i),
  );
  if (!isAdmin) return void (await reply(i, NO_PERMISSION));
  await run(
    {
      deps,
      db,
      i,
      audit: (action, target, details) =>
        auditDiscord(db, userId, action, target, details),
    },
    action,
  );
}

'use server';

import {
  addLecturer,
  addSubject,
  assignLecturer,
  banUser,
  CANCELLED_MESSAGE,
  cancelAdminBotRequest,
  classes,
  editClass,
  editLecturer,
  editSubject,
  emailOrNull,
  enqueueAdminBotRequest,
  getLecturerAdmin,
  requestPlanSync,
  subjects,
  textOrNull,
  urlOrNull,
  users,
  writeAudit,
} from '@studies/db';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  type ActionState,
  field,
  parseAssign,
  parseBan,
  parseClassEdit,
  parseCode,
  parseId,
  parseKind,
  parseLecturer,
  parseRequestKind,
  parseSubjectAdd,
  parseSubjectEdit,
} from './admin-forms';
import { getDb } from './db';
import { requireAdmin } from './session';

/**
 * Server Actions of the admin panel's Subjects, Lecturers, Users and Sync
 * tabs, for `useActionState`. They are reachable by direct POST, so each one
 * calls `requireAdmin()` itself (404 for everyone else), parses the form
 * (`admin-forms.ts`), calls the shared action from `@studies/db` on the main
 * pool, and audits only what was applied, with the bot's action names and
 * targets plus `source: 'web'`.
 */

const NO_CHANGES = 'No changes.';
const fail = (message: string): ActionState => ({ ok: false, message });
const done = (r: { ok: boolean; message: string }): ActionState => ({
  ok: r.ok,
  message: r.message,
});

async function audit(
  userId: number,
  action: string,
  target: string | null,
  details: object = {},
): Promise<void> {
  // The change is already committed: a failed audit write is logged, never
  // reported as a failed action (a retry would apply it twice), as the bot's
  // auditDiscord does.
  try {
    await writeAudit(getDb(), {
      userId,
      action,
      target,
      details: { ...details, source: 'web' },
    });
  } catch (err) {
    console.error('admin audit write failed', action, target, err);
  }
}

function refresh(...paths: string[]) {
  revalidatePath('/admin');
  revalidatePath('/admin/audit');
  for (const p of paths) revalidatePath(p);
}

/** An untouched stored URL (even one today's rule rejects) is not changed. */
const urlChanged = (v: string, stored: string | null) =>
  v !== (stored ?? '') && urlOrNull(v) !== stored;

const subjectPath = (code: string) =>
  `/admin/subjects/${encodeURIComponent(code)}`;

export async function addSubjectAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const p = parseSubjectAdd(form);
  if (!p.ok) return fail(p.message);
  const r = await addSubject(getDb(), p.value);
  if (r.ok) {
    await audit(user.id, 'subject.add', p.value.code, { channelId: null });
    refresh('/admin/subjects', subjectPath(p.value.code));
  }
  return done(r);
}

export async function editSubjectAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const c = parseCode(form);
  if (!c.ok) return fail(c.message);
  const db = getDb();
  const [cur] = await db
    .select()
    .from(subjects)
    .where(eq(subjects.code, c.value));
  // Unknown subject: the shared action gives the refusal.
  if (!cur) return done(await editSubject(db, c.value, {}));
  const p = parseSubjectEdit(form, cur);
  if (!p.ok) return fail(p.message);
  const v = p.value;
  // Only what changed, so the audit row names the edited fields.
  const patch: Parameters<typeof editSubject>[2] = {};
  if (v.name !== cur.name) patch.name = v.name;
  if (v.semester !== cur.semester) patch.semester = v.semester;
  if (v.ects !== cur.ects) patch.ects = v.ects;
  if (v.description !== cur.description) patch.description = v.description;
  if (urlChanged(v.platformUrl, cur.platformUrl))
    patch.platformUrl = v.platformUrl;
  const fields = Object.keys(patch);
  if (fields.length === 0)
    return { ok: true, message: NO_CHANGES, unchanged: true };
  const r = await editSubject(db, cur.code, patch);
  if (r.ok) {
    await audit(user.id, 'subject.edit', cur.code.toUpperCase(), { fields });
    refresh('/admin/subjects', subjectPath(cur.code));
  }
  return done(r);
}

export async function editClassAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const c = parseCode(form);
  if (!c.ok) return fail(c.message);
  const kind = parseKind(field(form, 'kind'));
  if (!kind) return fail('Unknown class type.');
  const db = getDb();
  const [cur] = await db
    .select({
      assessment: classes.assessment,
      note: classes.assessmentNote,
      platformUrl: classes.platformUrl,
    })
    .from(classes)
    .innerJoin(subjects, eq(subjects.id, classes.subjectId))
    .where(and(eq(subjects.code, c.value), eq(classes.kind, kind)));
  // No such subject or class: the shared action gives the refusal.
  if (!cur) return done(await editClass(db, { subjectCode: c.value, kind }));
  const p = parseClassEdit(form, cur);
  if (!p.ok) return fail(p.message);
  const v = p.value;
  const input: {
    assessment?: typeof v.assessment;
    note?: string;
    platformUrl?: string;
  } = {};
  if (v.assessment !== (cur.assessment ?? 'brak'))
    input.assessment = v.assessment;
  if (textOrNull(v.note) !== cur.note) input.note = v.note;
  if (urlChanged(v.platformUrl, cur.platformUrl))
    input.platformUrl = v.platformUrl;
  const fields = Object.keys(input);
  if (fields.length === 0)
    return { ok: true, message: NO_CHANGES, unchanged: true };
  const r = await editClass(db, {
    subjectCode: v.code,
    kind: v.kind,
    ...input,
  });
  if (r.ok) {
    await audit(user.id, 'class.edit', v.code, { kind: v.kind, fields });
    refresh(subjectPath(v.code));
  }
  return done(r);
}

export async function addLecturerAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const p = parseLecturer(form);
  if (!p.ok) return fail(p.message);
  const r = await addLecturer(getDb(), p.value);
  if (r.ok && r.id !== undefined) {
    await audit(user.id, 'lecturer.add', String(r.id), { name: p.value.name });
    refresh('/admin/lecturers', `/admin/lecturers/${r.id}`);
  }
  return done(r);
}

export async function editLecturerAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const id = parseId(field(form, 'id'));
  if (id === null) return fail('Lecturer not found.');
  const db = getDb();
  const cur = await getLecturerAdmin(db, id);
  if (!cur) return fail(`Lecturer with id ${id} not found.`);
  const p = parseLecturer(form, cur);
  if (!p.ok) return fail(p.message);
  const v = p.value;
  const patch: Parameters<typeof editLecturer>[2] = {};
  if (v.name !== cur.name) patch.name = v.name;
  if (textOrNull(v.title) !== cur.title) patch.title = v.title;
  if (emailOrNull(v.email) !== cur.email) patch.email = v.email;
  if (textOrNull(v.officeHours) !== cur.officeHours)
    patch.officeHours = v.officeHours;
  if (textOrNull(v.room) !== cur.room) patch.room = v.room;
  const fields = Object.keys(patch);
  if (fields.length === 0)
    return { ok: true, message: NO_CHANGES, unchanged: true };
  const r = await editLecturer(db, id, patch);
  if (r.ok) {
    await audit(user.id, 'lecturer.edit', String(id), { fields });
    refresh('/admin/lecturers', `/admin/lecturers/${id}`);
    // Subject pages list their lecturers by name.
    revalidatePath('/admin/subjects', 'layout');
  }
  return done(r);
}

export async function assignLecturerAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const p = parseAssign(form);
  if (!p.ok) return fail(p.message);
  const v = p.value;
  const r = await assignLecturer(getDb(), {
    subjectCode: v.code,
    lecturerId: v.lecturerId,
    classKind: v.kind,
    groupNumber: v.group,
  });
  if (r.ok) {
    await audit(user.id, 'lecturer.assign', v.code, {
      lecturerId: v.lecturerId,
      classKind: v.kind,
      groupNumber: v.group,
    });
    refresh(subjectPath(v.code), `/admin/lecturers/${v.lecturerId}`);
  }
  return done(r);
}

export async function setBanAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const p = parseBan(form);
  if (!p.ok) return fail(p.message);
  const db = getDb();
  const [me] = await db
    .select({ discordUserId: users.discordUserId })
    .from(users)
    .where(eq(users.id, user.id));
  if (p.value.banned && me?.discordUserId === p.value.discordUserId)
    return fail('You cannot block yourself.');
  const r = await banUser(db, p.value.discordUserId, p.value.banned);
  if (r.ok) {
    await audit(
      user.id,
      p.value.banned ? 'user.ban' : 'user.unban',
      p.value.discordUserId,
    );
    refresh('/admin/users');
  }
  return done(r);
}

export async function requestPlanSyncAction(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  await requestPlanSync(getDb());
  await audit(user.id, 'plan.sync', null);
  refresh('/admin/sync');
  return {
    ok: true,
    message:
      'Timetable sync requested (the worker will run it within a minute).',
  };
}

export async function requestBotAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const p = parseRequestKind(form);
  if (!p.ok) return fail(p.message);
  const r = await enqueueAdminBotRequest(getDb(), p.value, user.id);
  if (!r.ok) return fail(r.message);
  await audit(user.id, 'bot.request', `bot_request:${r.id}`, {
    kind: p.value,
  });
  refresh('/admin/sync');
  return {
    ok: true,
    message: 'Request queued. The bot will pick it up within a few seconds.',
  };
}

export async function cancelBotRequestAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const id = parseId(field(form, 'id'));
  if (id === null) return fail('Request not found.');
  const cancelled = await cancelAdminBotRequest(getDb(), id);
  if (!cancelled)
    return fail('Only a request that is still waiting can be cancelled.');
  await audit(user.id, 'bot.request_cancel', `bot_request:${id}`);
  refresh('/admin/sync');
  return { ok: true, message: CANCELLED_MESSAGE };
}

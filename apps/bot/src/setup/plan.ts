// Pure planner for /setup: DB subjects + a snapshot of the guild -> the
// actions that bring the guild in line. No discord.js or DB access here.
import { CLASS_NAMES, groupName, stripMarks } from '@studies/db';
import type { Action, GuildSnapshot, SubjectSpec } from './types.js';

export const MAX_FORUM_TAGS = 20;
const MAX_CHANNEL_NAME = 100;
const FIXED_TAGS = ['Kolokwium', 'Egzamin'];

export function forumSlug(code: string, name: string): string {
  return stripMarks(`${code}-${name}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_CHANNEL_NAME)
    .replace(/^-+|-+$/g, '');
}

/** Tag identity: trimmed, case- and diacritic-insensitive. */
export function tagKey(name: string): string {
  return stripMarks(name.trim()).toLowerCase();
}

export function desiredTags(s: SubjectSpec): string[] {
  const maxGroup = Math.max(0, ...s.classes.flatMap((c) => c.groups));
  return [
    ...s.classes.map((c) => CLASS_NAMES[c.kind]),
    ...Array.from({ length: maxGroup }, (_, i) => groupName(i + 1)),
    ...FIXED_TAGS,
  ];
}

const categoryName = (s: SubjectSpec) => `Semestr ${s.semester}`;

/** Splits `wanted` into what fits next to `existing` tags and what doesn't. */
function fitTags(existingCount: number, wanted: string[]) {
  const room = Math.max(0, MAX_FORUM_TAGS - existingCount);
  return { fit: wanted.slice(0, room), dropped: wanted.slice(room) };
}

const tooManyTags = (code: string, dropped: string[]): Action => ({
  type: 'warn',
  code,
  message: `limit ${MAX_FORUM_TAGS} tagów — pominięto: ${dropped.join(', ')}`,
});

export function planSetup(
  subjects: SubjectSpec[],
  g: GuildSnapshot,
  roleName: string,
  render: (s: SubjectSpec) => string,
): Action[] {
  const actions: Action[] = [];

  const role = g.roles.find((r) => r.name === roleName);
  if (!role) actions.push({ type: 'createRole', name: roleName });
  if (!role || !g.callerRoleIds.includes(role.id)) {
    actions.push({ type: 'assignRole', roleName, userId: g.callerId });
  }

  const categories = new Set(g.categories.map((c) => c.name));
  const forums = new Map(g.forums.map((f) => [f.id, f]));
  const ordered = [...subjects].sort(
    (a, b) => a.semester - b.semester || a.code.localeCompare(b.code),
  );

  for (const s of ordered) {
    const wanted = desiredTags(s);
    const topic = render(s);

    if (s.channelId === null) {
      const category = categoryName(s);
      if (!categories.has(category)) {
        actions.push({ type: 'createCategory', name: category });
        categories.add(category);
      }
      const { fit, dropped } = fitTags(0, wanted);
      actions.push({
        type: 'createForum',
        subjectId: s.id,
        code: s.code,
        name: forumSlug(s.code, s.name),
        categoryName: category,
        tags: fit,
        topic,
      });
      if (dropped.length > 0) actions.push(tooManyTags(s.code, dropped));
      continue;
    }

    const forum = forums.get(s.channelId);
    if (!forum) {
      actions.push({
        type: 'warn',
        code: s.code,
        message:
          'nie znaleziono połączonego forum (usunięte lub bot go nie widzi) — pominięto',
      });
      continue;
    }

    const have = new Set(forum.tags.map((t) => tagKey(t.name)));
    const missing = wanted.filter((t) => !have.has(tagKey(t)));
    const { fit, dropped } = fitTags(forum.tags.length, missing);
    if (fit.length > 0) {
      actions.push({
        type: 'addTags',
        subjectId: s.id,
        code: s.code,
        channelId: forum.id,
        tags: fit,
      });
    }
    if (dropped.length > 0) actions.push(tooManyTags(s.code, dropped));
    if (forum.topic !== topic) {
      actions.push({
        type: 'setGuidelines',
        subjectId: s.id,
        code: s.code,
        channelId: forum.id,
        topic,
      });
    }
  }
  return actions;
}

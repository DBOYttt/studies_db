// Pure planner for /setup: DB subjects + a snapshot of the guild -> the
// actions that bring the guild in line. No discord.js or DB access here.
import {
  CLASS_KINDS,
  CLASS_NAMES,
  type ClassKind,
  classifyTags,
  groupName,
  stripMarks,
} from '@studies/db';
import type { ForumTag } from '../types.js';
import { renderInfoPost } from './info.js';
import type {
  Action,
  AdminRole,
  ForumSnapshot,
  GuildSnapshot,
  PostMessage,
  SubjectSpec,
  TopicSpec,
} from './types.js';

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
const MAX_CODE = 20;
const SEMESTER_RE = /^Semestr (\d+)$/;

/** `asd-algorytmy-i-struktury` → ASD / "Algorytmy i struktury"; null if no code. */
export function parseForumName(
  forumName: string,
): { code: string; name: string } | null {
  const dash = forumName.indexOf('-');
  const head = dash < 0 ? forumName : forumName.slice(0, dash);
  const rest = dash < 0 ? '' : forumName.slice(dash + 1);
  const code = stripMarks(head)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_CODE);
  if (!code) return null;
  const words = (rest || head).replace(/[-_]+/g, ' ').trim();
  return { code, name: words.charAt(0).toUpperCase() + words.slice(1) };
}

/** Class kinds named by forum tags, in CLASS_KINDS order. */
function classKindsOf(tags: ForumTag[]): ClassKind[] {
  const kinds = new Set(
    tags.map((t) => classifyTags([t.name]).classKind).filter((k) => k !== null),
  );
  return CLASS_KINDS.filter((k) => kinds.has(k));
}

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

export const MAX_POST_TAGS = 5;
export const MAX_FILES_PER_MESSAGE = 10;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_THREAD_NAME = 100;

/** Starter (+ follow-up) messages for a DB topic posted by the bot. */
function topicMessages(t: TopicSpec, webBaseUrl: string): PostMessage[] {
  const header = `Dodane przez ${t.authorName ?? 'nieznanego autora'} · ${t.createdAt
    .toISOString()
    .slice(0, 10)} (z bazy Studies DB)`;
  const upload = t.materials.filter((m) => m.sizeBytes <= MAX_UPLOAD_BYTES);
  const linked = t.materials.filter((m) => m.sizeBytes > MAX_UPLOAD_BYTES);
  const links =
    linked.length > 0
      ? [
          'Za duże do wysłania na Discord:',
          ...linked.map(
            (m) => `${m.filename}: ${webBaseUrl}/files/${m.id}/original`,
          ),
        ]
      : [];
  const files = upload.map((m) => ({
    materialId: m.id,
    name: m.filename,
    storagePath: m.storagePath,
  }));
  const messages: PostMessage[] = [];
  for (let i = 0; i < Math.max(files.length, 1); i += MAX_FILES_PER_MESSAGE) {
    messages.push({
      content: i === 0 ? [header, ...links].join('\n') : 'Pliki (cd.)',
      files: files.slice(i, i + MAX_FILES_PER_MESSAGE),
    });
  }
  return messages;
}

function topicTagIds(t: TopicSpec, forum: ForumSnapshot): string[] {
  const byKey = new Map(forum.tags.map((x) => [tagKey(x.name), x.id]));
  const names = [
    ...(t.classKind ? [CLASS_NAMES[t.classKind]] : []),
    ...(t.group !== null ? [groupName(t.group)] : []),
    ...t.tagNames,
  ];
  const ids = names.flatMap((n) => byKey.get(tagKey(n)) ?? []);
  return [...new Set(ids)].slice(0, MAX_POST_TAGS);
}

function planPosts(
  s: SubjectSpec,
  forum: ForumSnapshot,
  webBaseUrl: string,
): Action[] {
  const out: Action[] = [];
  const onDiscord = new Set(forum.threadIds ?? []);
  for (const t of s.topics ?? []) {
    if (onDiscord.has(t.threadId)) continue;
    out.push({
      type: 'postTopic',
      subjectId: s.id,
      code: s.code,
      channelId: forum.id,
      topicId: t.id,
      title: t.title.slice(0, MAX_THREAD_NAME),
      tagIds: topicTagIds(t, forum),
      messages: topicMessages(t, webBaseUrl),
    });
  }
  const content = renderInfoPost(s, webBaseUrl);
  const info = forum.infoPost ?? null;
  const same = info?.content === content;
  if (!info || !same || !info.pinned) {
    out.push({
      type: 'upsertInfoPost',
      subjectId: s.id,
      code: s.code,
      channelId: forum.id,
      content,
      existing: info && {
        threadId: info.threadId,
        messageId: info.messageId,
        pinned: info.pinned,
        same,
      },
    });
  }
  return out;
}

/** New forums only get posts/info posts on a second plan over the new state. */
export function needsSecondPass(actions: Action[]): boolean {
  return actions.some(
    (a) => a.type === 'createForum' || a.type === 'importForum',
  );
}

/**
 * Admin role by stored id; else the only role with the configured name is
 * adopted, or a new one created. Several roles with that name: warn only.
 */
function planRole(role: AdminRole, g: GuildSnapshot): Action[] {
  const { name } = role;
  const assign = (roleId: string | null): Action[] =>
    roleId !== null && g.callerRoleIds.includes(roleId)
      ? []
      : [{ type: 'assignRole', roleName: name, roleId, userId: g.callerId }];
  if (role.storedId !== null && g.roles.some((r) => r.id === role.storedId)) {
    return assign(role.storedId);
  }
  const named = g.roles.filter((r) => r.name === name);
  if (named.length === 0) {
    return [{ type: 'createRole', name }, ...assign(null)];
  }
  if (named.length === 1) {
    return [
      { type: 'adoptRole', roleId: named[0].id, name },
      ...assign(named[0].id),
    ];
  }
  return [
    {
      type: 'warn',
      code: null,
      message: `jest kilka ról o nazwie „${name}” — rola admina nie została ustawiona; zostaw jedną (albo zmień nazwy pozostałych) i uruchom /setup ponownie`,
    },
  ];
}

export function planSetup(
  subjects: SubjectSpec[],
  g: GuildSnapshot,
  role: AdminRole,
  render: (s: SubjectSpec) => string,
  opts?: { webBaseUrl: string },
): Action[] {
  const actions: Action[] = planRole(role, g);

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

    const known = new Set(s.classes.map((c) => c.kind));
    const newKinds = classKindsOf(forum.tags).filter((k) => !known.has(k));
    if (newKinds.length > 0) {
      actions.push({
        type: 'addClasses',
        subjectId: s.id,
        code: s.code,
        kinds: newKinds,
      });
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
    if (opts) actions.push(...planPosts(s, forum, opts.webBaseUrl));
  }

  // Discord → DB: forums no subject points to become subjects.
  const linked = new Set(subjects.map((s) => s.channelId));
  const codes = new Set(subjects.map((s) => s.code.toUpperCase()));
  const categoryById = new Map(g.categories.map((c) => [c.id, c.name]));
  for (const f of g.forums) {
    if (linked.has(f.id)) continue;
    const parsed = parseForumName(f.name);
    if (!parsed) {
      actions.push({
        type: 'warn',
        code: null,
        message: `#${f.name}: nie da się ustalić kodu przedmiotu — pominięto`,
      });
      continue;
    }
    if (codes.has(parsed.code)) {
      actions.push({
        type: 'warn',
        code: parsed.code,
        message: `kod zajęty, forum #${f.name} pominięto`,
      });
      continue;
    }
    codes.add(parsed.code);
    const m = SEMESTER_RE.exec(categoryById.get(f.parentId ?? '') ?? '');
    actions.push({
      type: 'importForum',
      channelId: f.id,
      forumName: f.name,
      code: parsed.code,
      name: parsed.name,
      semester: m ? Number(m[1]) : 1,
      tags: f.tags,
      classKinds: classKindsOf(f.tags),
    });
  }
  return actions;
}

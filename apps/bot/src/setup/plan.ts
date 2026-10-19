// Pure planner for /setup: DB subjects + a snapshot of the guild -> the
// actions that bring the guild in line. No discord.js or DB access here.
import {
  CLASS_KINDS,
  CLASS_NAMES,
  type ClassKind,
  classifyTags,
  EVENT_KINDS,
  groupName,
  stripMarks,
} from '@studies/db';
import type { ForumTag } from '../types.js';
import {
  EVENTS_FORUM_NAME,
  EVENTS_FORUM_TOPIC,
  renderEventsInfoPost,
  renderInfoPost,
} from './info.js';
import type {
  Action,
  AdminRole,
  ForumSnapshot,
  GuildSnapshot,
  MaterialSpec,
  PanelWhich,
  PostFile,
  PostMessage,
  SubjectSpec,
  TopicSpec,
} from './types.js';

export const MAX_FORUM_TAGS = 20;
const MAX_CHANNEL_NAME = 100;
/** Forum tags for the event kinds (Test and Exam double as the fixed tags). */
export const EVENT_KIND_TAGS = Object.values(EVENT_KINDS).map((k) => k.label);
/** Label of the #wydarzenia actions in the report. */
export const EVENTS_LABEL = '#wydarzenia';

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
    ...EVENT_KIND_TAGS,
  ].filter((t, i, all) => all.findIndex((x) => tagKey(x) === tagKey(t)) === i);
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

const unreadableWarn = (code: string | null, f: { name: string }): Action => ({
  type: 'warn',
  code,
  message: `bot nie może odczytać forum #${f.name} (sprawdź View Channel i Read Message History) — pominięto`,
});

const tooManyTags = (code: string, dropped: string[]): Action => ({
  type: 'warn',
  code,
  message: `limit ${MAX_FORUM_TAGS} tagów — pominięto: ${dropped.join(', ')}`,
});

export const MAX_POST_TAGS = 5;
export const MAX_FILES_PER_MESSAGE = 10;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Request size budget per message (Discord rejects bodies over ~25 MiB). */
export const MAX_MESSAGE_BYTES = 24 * 1024 * 1024;

/** Splits files into messages of at most 10 files and 24 MiB each. */
export function chunkFiles(files: PostFile[]): PostFile[][] {
  const out: PostFile[][] = [];
  let cur: PostFile[] = [];
  let bytes = 0;
  for (const f of files) {
    if (
      cur.length > 0 &&
      (cur.length >= MAX_FILES_PER_MESSAGE ||
        bytes + f.sizeBytes > MAX_MESSAGE_BYTES)
    ) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(f);
    bytes += f.sizeBytes;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}
const MAX_THREAD_NAME = 100;

const FILES_CONTINUED = 'Pliki (cd.)';

const postFile = (m: MaterialSpec): PostFile => ({
  materialId: m.id,
  name: m.filename,
  storagePath: m.storagePath,
  sizeBytes: m.sizeBytes,
});

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
  const chunks = chunkFiles(upload.map(postFile));
  return (chunks.length > 0 ? chunks : [[]]).map((files, i) => ({
    content: i === 0 ? [header, ...links].join('\n') : FILES_CONTINUED,
    files,
  }));
}

/** Uploadable files of a bot-owned thread whose message is gone (or never sent). */
function planMissingFiles(
  s: SubjectSpec,
  t: TopicSpec,
  forum: ForumSnapshot,
): Action[] {
  const ids = forum.botThreadMessageIds?.[t.threadId];
  if (!ids) return [];
  const have = new Set(ids);
  const missing = t.materials.filter(
    (m) => m.sizeBytes <= MAX_UPLOAD_BYTES && !have.has(m.discordMessageId),
  );
  if (missing.length === 0) return [];
  return [
    {
      type: 'postFiles',
      subjectId: s.id,
      code: s.code,
      topicId: t.id,
      threadId: t.threadId,
      title: t.title.slice(0, MAX_THREAD_NAME),
      messages: chunkFiles(missing.map(postFile)).map((files) => ({
        content: FILES_CONTINUED,
        files,
      })),
    },
  ];
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
    if (onDiscord.has(t.threadId)) {
      out.push(...planMissingFiles(s, t, forum));
      continue;
    }
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
  const base = {
    type: 'upsertInfoPost',
    subjectId: s.id,
    code: s.code,
    channelId: forum.id,
    content,
  } as const;
  if (!info) {
    // Discord allows one pinned post per forum; never unpin someone else's.
    const pin = !forum.pinnedThreadId;
    out.push({ ...base, existing: null, pin });
    if (!pin) {
      out.push({
        type: 'warn',
        code: s.code,
        message:
          'nie przypięto posta informacyjnego, bo w forum jest już przypięty inny post',
      });
    }
  } else if (info.content !== content) {
    out.push({
      ...base,
      existing: { threadId: info.threadId, messageId: info.messageId },
      pin: false,
    });
  }
  return out;
}

/** New forums only get posts/info posts on a second plan over the new state. */
export function needsSecondPass(actions: Action[]): boolean {
  return actions.some(
    (a) =>
      a.type === 'createForum' ||
      a.type === 'importForum' ||
      (a.type === 'ensureEventsForum' && a.existingId === null),
  );
}

const PANEL_ACTIONS = new Set<Action['type']>([
  'ensurePanelChannel',
  'syncAdminPanelPerms',
  'ensurePanelMessage',
]);

/**
 * The second plan, minus what the first pass handled: the panels, and
 * warnings it already reported.
 */
export function secondPassActions(first: Action[], second: Action[]): Action[] {
  const warned = new Set(
    first.flatMap((a) =>
      a.type === 'warn' ? [`${a.code}\n${a.message}`] : [],
    ),
  );
  return second.filter(
    (a) =>
      !PANEL_ACTIONS.has(a.type) &&
      !(a.type === 'warn' && warned.has(`${a.code}\n${a.message}`)),
  );
}

/**
 * Admin role by stored id; else the only role with the configured name is
 * adopted, or a new one created. Several roles with that name: warn only.
 * roleId is the admin role after these actions: null for the role created
 * in this run, undefined when there is none (ambiguous name).
 */
function planRole(
  role: AdminRole,
  g: GuildSnapshot,
): { actions: Action[]; roleId: string | null | undefined } {
  const { name } = role;
  const assign = (roleId: string | null): Action[] =>
    roleId !== null && g.callerRoleIds.includes(roleId)
      ? []
      : [{ type: 'assignRole', roleName: name, roleId, userId: g.callerId }];
  if (role.storedId !== null && g.roles.some((r) => r.id === role.storedId)) {
    return { actions: assign(role.storedId), roleId: role.storedId };
  }
  const named = g.roles.filter((r) => r.name === name);
  if (named.length === 0) {
    return {
      actions: [{ type: 'createRole', name }, ...assign(null)],
      roleId: null,
    };
  }
  if (named.length === 1) {
    return {
      actions: [
        { type: 'adoptRole', roleId: named[0].id, name },
        ...assign(named[0].id),
      ],
      roleId: named[0].id,
    };
  }
  return {
    actions: [
      {
        type: 'warn',
        code: null,
        message: `jest kilka ról o nazwie „${name}” — rola admina nie została ustawiona; zostaw jedną (albo zmień nazwy pozostałych) i uruchom /setup ponownie`,
      },
    ],
    roleId: undefined,
  };
}

export const PANEL_CHANNEL_NAMES = {
  panel: 'panel',
  admin: 'admin-panel',
} as const satisfies Record<PanelWhich, string>;

/**
 * The #panel and #admin-panel channels and their permanent messages. A stored
 * channel that still exists is kept; otherwise the only text channel with the
 * name is adopted, or a new one created (several with the name: warn only).
 * A kept or adopted #admin-panel that does not let the current admin role
 * view it gets its permissions synced. The message is always planned: apply
 * edits it in place, or posts it when it is gone.
 */
function planPanels(
  ordered: SubjectSpec[],
  g: GuildSnapshot,
  adminRoleId: string | null | undefined,
): Action[] {
  const forums = new Map(g.forums.map((f) => [f.id, f]));
  const first = ordered.find((s) => s.channelId && forums.has(s.channelId));
  const parentId = first?.channelId
    ? (forums.get(first.channelId)?.parentId ?? null)
    : null;
  const channels: Action[] = [];
  const perms: Action[] = [];
  const messages: Action[] = [];
  const syncPerms = (channelId: string) => {
    if (adminRoleId === undefined) return;
    const c = g.textChannels.find((x) => x.id === channelId);
    if (adminRoleId !== null && c?.viewRoleIds.includes(adminRoleId)) return;
    perms.push({ type: 'syncAdminPanelPerms', channelId, roleId: adminRoleId });
  };
  for (const which of ['panel', 'admin'] as const) {
    const name = PANEL_CHANNEL_NAMES[which];
    const stored = g.panelChannels[which];
    if (stored !== null && g.textChannels.some((c) => c.id === stored)) {
      if (which === 'admin') syncPerms(stored);
      messages.push({
        type: 'ensurePanelMessage',
        which,
        channelId: stored,
        messageId: g.panelMessages[which],
      });
      continue;
    }
    const named = g.textChannels.filter((c) => c.name === name);
    if (named.length > 1) {
      channels.push({
        type: 'warn',
        code: null,
        message: `jest kilka kanałów tekstowych o nazwie #${name} — panel nie został utworzony; zostaw jeden (albo zmień nazwy pozostałych) i uruchom /setup ponownie`,
      });
      continue;
    }
    const existingId = named.length === 1 ? named[0].id : null;
    channels.push({
      type: 'ensurePanelChannel',
      which,
      name,
      existingId,
      parentId,
    });
    if (which === 'admin' && existingId !== null) syncPerms(existingId);
    messages.push({
      type: 'ensurePanelMessage',
      which,
      channelId: null,
      messageId: null,
    });
  }
  return [...channels, ...perms, ...messages];
}

/**
 * The shared #wydarzenia forum: the stored one if it still exists, else the
 * only forum with that name is adopted, else a new one is created. It gets
 * the event kind tags and a pinned info post (a new forum gets its post on
 * the second pass).
 */
function planEventsForum(
  ordered: SubjectSpec[],
  g: GuildSnapshot,
  opts?: { webBaseUrl: string },
): Action[] {
  const code = EVENTS_LABEL;
  const stored = g.eventsForumId ?? null;
  const linked = new Set(ordered.map((s) => s.channelId));
  let forum = stored ? g.forums.find((f) => f.id === stored) : undefined;
  const out: Action[] = [];
  if (!forum) {
    const unreadable = g.unreadableForums.find((f) => f.id === stored);
    if (unreadable) return [unreadableWarn(code, unreadable)];
    const named = [
      ...g.forums,
      ...g.unreadableForums.map((f) => ({ ...f, tags: [] })),
    ].filter((f) => f.name === EVENTS_FORUM_NAME && !linked.has(f.id));
    if (named.length > 1) {
      return [
        {
          type: 'warn',
          code,
          message: `jest kilka forów o nazwie #${EVENTS_FORUM_NAME} — nie wybrano żadnego; zostaw jedno (albo zmień nazwy pozostałych) i uruchom /setup ponownie`,
        },
      ];
    }
    const found = named[0] ? g.forums.find((f) => f.id === named[0].id) : null;
    if (named[0] && !found) return [unreadableWarn(code, named[0])];
    if (!found) {
      const first = ordered.find((s) =>
        g.forums.some((f) => f.id === s.channelId),
      );
      const parentId =
        g.forums.find((f) => f.id === first?.channelId)?.parentId ?? null;
      const { fit, dropped } = fitTags(0, EVENT_KIND_TAGS);
      out.push({
        type: 'ensureEventsForum',
        code,
        name: EVENTS_FORUM_NAME,
        existingId: null,
        parentId,
        tags: fit,
        topic: EVENTS_FORUM_TOPIC,
      });
      if (dropped.length > 0) out.push(tooManyTags(code, dropped));
      return out;
    }
    forum = found;
    out.push({
      type: 'ensureEventsForum',
      code,
      name: EVENTS_FORUM_NAME,
      existingId: found.id,
      parentId: found.parentId,
      tags: [],
      topic: EVENTS_FORUM_TOPIC,
    });
  }
  const have = new Set(forum.tags.map((t) => tagKey(t.name)));
  const missing = EVENT_KIND_TAGS.filter((t) => !have.has(tagKey(t)));
  const { fit, dropped } = fitTags(forum.tags.length, missing);
  if (fit.length > 0) {
    out.push({ type: 'addEventsTags', code, channelId: forum.id, tags: fit });
  }
  if (dropped.length > 0) out.push(tooManyTags(code, dropped));
  if (!opts) return out;
  const content = renderEventsInfoPost(opts.webBaseUrl);
  const info = forum.infoPost ?? null;
  const base = {
    type: 'upsertEventsInfoPost',
    code,
    channelId: forum.id,
    content,
  } as const;
  if (!info) {
    const pin = !forum.pinnedThreadId;
    out.push({ ...base, existing: null, pin });
    if (!pin) {
      out.push({
        type: 'warn',
        code,
        message:
          'nie przypięto posta informacyjnego, bo w forum jest już przypięty inny post',
      });
    }
  } else if (info.content !== content) {
    out.push({
      ...base,
      existing: { threadId: info.threadId, messageId: info.messageId },
      pin: false,
    });
  }
  return out;
}

export function planSetup(
  subjects: SubjectSpec[],
  g: GuildSnapshot,
  role: AdminRole,
  render: (s: SubjectSpec) => string,
  opts?: { webBaseUrl: string },
): Action[] {
  const { actions, roleId: adminRoleId } = planRole(role, g);

  const categories = new Set(g.categories.map((c) => c.name));
  const forums = new Map(g.forums.map((f) => [f.id, f]));
  const ordered = [...subjects].sort(
    (a, b) => a.semester - b.semester || a.code.localeCompare(b.code),
  );
  // Right after the role: #admin-panel needs the admin role id.
  actions.push(...planPanels(ordered, g, adminRoleId));
  actions.push(...planEventsForum(ordered, g, opts));

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
    const unreadable = g.unreadableForums.find((f) => f.id === s.channelId);
    if (unreadable) {
      actions.push(unreadableWarn(s.code, unreadable));
      continue;
    }
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
  const isEventsForum = (f: { id: string; name: string }) =>
    f.id === g.eventsForumId || f.name === EVENTS_FORUM_NAME;
  for (const f of g.unreadableForums) {
    if (!linked.has(f.id) && !isEventsForum(f))
      actions.push(unreadableWarn(null, f));
  }
  for (const f of g.forums) {
    if (linked.has(f.id) || isEventsForum(f)) continue;
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

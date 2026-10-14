import type { Assessment, ClassKind } from '@studies/db/constants';
import type { ForumTag } from '../types.js';

export type LecturerSpec = {
  name: string;
  title: string | null;
  /** Group number for a group-scoped assignment, null for the whole class. */
  group: number | null;
  email?: string | null;
  officeHours?: string | null;
  room?: string | null;
};

/** One timetable occurrence. Times are wall Dates (UTC fields = Warsaw clock). */
export type SessionSpec = {
  uid: string;
  classKind: ClassKind | null;
  group: number | null;
  label: string | null;
  room: string | null;
  startsAt: Date;
  endsAt: Date;
  status: 'confirmed' | 'cancelled';
};

export type MaterialSpec = {
  id: number;
  filename: string;
  storagePath: string;
  sizeBytes: number;
  /** Discord message the file is currently linked to. */
  discordMessageId: string;
};

export type TopicSpec = {
  id: number;
  title: string;
  threadId: string;
  classKind: ClassKind | null;
  group: number | null;
  tagNames: string[];
  authorName: string | null;
  createdAt: Date;
  materials: MaterialSpec[];
};

export type ClassSpec = {
  kind: ClassKind;
  name: string;
  assessment: Assessment | null;
  assessmentNote: string | null;
  platformUrl: string | null;
  groups: number[];
  lecturers: LecturerSpec[];
};

export type SubjectSpec = {
  id: number;
  code: string;
  name: string;
  semester: number;
  ects: number;
  platformUrl: string | null;
  channelId: string | null;
  classes: ClassSpec[];
  topics?: TopicSpec[];
  /** Upcoming sessions (next 14 days) for the info post. */
  sessions?: SessionSpec[];
};

export type ForumSnapshot = {
  id: string;
  name: string;
  parentId: string | null;
  tags: ForumTag[];
  topic: string | null;
  /** Thread ids in the forum (active + archived). */
  threadIds?: string[];
  /** The bot's info post, if any. */
  infoPost?: InfoPostSnapshot | null;
  /** A pinned thread in the forum (Discord allows one), if any. */
  pinnedThreadId?: string | null;
  /** Message ids of each bot-owned thread in the forum. */
  botThreadMessageIds?: Record<string, string[]>;
};

export type InfoPostSnapshot = {
  threadId: string;
  messageId: string;
  content: string;
};

export type PostFile = {
  materialId: number;
  name: string;
  storagePath: string;
  sizeBytes: number;
};
export type PostMessage = { content: string; files: PostFile[] };

export type GuildSnapshot = {
  categories: { id: string; name: string }[];
  forums: ForumSnapshot[];
  roles: { id: string; name: string }[];
  callerId: string;
  callerRoleIds: string[];
  /** Forums the bot cannot read (permissions or a failed fetch); not in `forums`. */
  unreadableForums: { id: string; name: string }[];
  textChannels: { id: string; name: string; parentId: string | null }[];
  /** Panel channel ids stored in bot_settings. */
  panelChannels: { panel: string | null; admin: string | null };
  /** Panel message ids stored in bot_settings. */
  panelMessages: { panel: string | null; admin: string | null };
};

export type PanelWhich = 'panel' | 'admin';

/** The admin role: its configured name and the id stored in bot_settings. */
export type AdminRole = { name: string; storedId: string | null };

export type Action =
  /** Creates the admin role and stores its id. */
  | { type: 'createRole'; name: string }
  /** Stores the id of an existing role as the admin role. */
  | { type: 'adoptRole'; roleId: string; name: string }
  /** roleId null: the role created earlier in the same run. */
  | {
      type: 'assignRole';
      roleName: string;
      roleId: string | null;
      userId: string;
    }
  | { type: 'createCategory'; name: string }
  | {
      type: 'createForum';
      subjectId: number;
      code: string;
      name: string;
      categoryName: string;
      tags: string[];
      topic: string;
    }
  | {
      type: 'addTags';
      subjectId: number;
      code: string;
      channelId: string;
      tags: string[];
    }
  | {
      type: 'setGuidelines';
      subjectId: number;
      code: string;
      channelId: string;
      topic: string;
    }
  | {
      type: 'importForum';
      channelId: string;
      forumName: string;
      code: string;
      name: string;
      semester: number;
      tags: ForumTag[];
      classKinds: ClassKind[];
    }
  | { type: 'addClasses'; subjectId: number; code: string; kinds: ClassKind[] }
  | {
      type: 'postTopic';
      subjectId: number;
      code: string;
      channelId: string;
      topicId: number;
      title: string;
      tagIds: string[];
      messages: PostMessage[];
    }
  /** Files of a bot-posted topic missing from its thread (lost follow-ups). */
  | {
      type: 'postFiles';
      subjectId: number;
      code: string;
      topicId: number;
      threadId: string;
      title: string;
      messages: PostMessage[];
    }
  | {
      type: 'upsertInfoPost';
      subjectId: number;
      code: string;
      channelId: string;
      content: string;
      /** Set: edit this message. Null: create the post. */
      existing: { threadId: string; messageId: string } | null;
      /** Pin a newly created post (only when no other post is pinned). */
      pin: boolean;
    }
  /**
   * Creates the panel text channel (existingId null) or stores the id of the
   * only text channel with that name (adopted as is, permissions untouched).
   */
  | {
      type: 'ensurePanelChannel';
      which: PanelWhich;
      name: 'panel' | 'admin-panel';
      existingId: string | null;
      parentId: string | null;
    }
  /**
   * Edits the stored panel message, or posts it (and stores the id) when it
   * is gone or was never posted. channelId null: the channel from the
   * ensurePanelChannel action earlier in the same run.
   */
  | {
      type: 'ensurePanelMessage';
      which: PanelWhich;
      channelId: string | null;
      messageId: string | null;
    }
  | { type: 'warn'; code: string | null; message: string };

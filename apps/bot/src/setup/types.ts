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
  /** The bot's pinned info post, if any. */
  infoPost?: InfoPostSnapshot | null;
};

export type InfoPostSnapshot = {
  threadId: string;
  messageId: string;
  content: string;
  pinned: boolean;
};

export type PostFile = {
  materialId: number;
  name: string;
  storagePath: string;
};
export type PostMessage = { content: string; files: PostFile[] };

export type GuildSnapshot = {
  categories: { id: string; name: string }[];
  forums: ForumSnapshot[];
  roles: { id: string; name: string }[];
  callerId: string;
  callerRoleIds: string[];
};

export type Action =
  | { type: 'createRole'; name: string }
  | { type: 'assignRole'; roleName: string; userId: string }
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
  | {
      type: 'upsertInfoPost';
      subjectId: number;
      code: string;
      channelId: string;
      content: string;
      existing: {
        threadId: string;
        messageId: string;
        pinned: boolean;
        same: boolean;
      } | null;
    }
  | { type: 'warn'; code: string | null; message: string };

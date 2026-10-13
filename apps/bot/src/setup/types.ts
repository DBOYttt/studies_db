import type { Assessment, ClassKind } from '@studies/db/constants';
import type { ForumTag } from '../types.js';

export type LecturerSpec = {
  name: string;
  title: string | null;
  /** Group number for a group-scoped assignment, null for the whole class. */
  group: number | null;
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
};

export type ForumSnapshot = {
  id: string;
  name: string;
  parentId: string | null;
  tags: ForumTag[];
  topic: string | null;
};

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
  | { type: 'warn'; code: string | null; message: string };

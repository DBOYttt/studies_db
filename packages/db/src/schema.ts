import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  datetime,
  index,
  int,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  tinyint,
  varchar,
} from 'drizzle-orm/mysql-core';
import type { JobType, PreviewKind } from './files.js';

const JOB_TYPES = [
  'convert',
  'extract_text',
] as const satisfies readonly JobType[];
const PREVIEW_KINDS = [
  'pdf',
  'image',
  'text',
  'none',
] as const satisfies readonly PreviewKind[];

const now = () =>
  datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`);

export const subjects = mysqlTable('subjects', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  semester: tinyint('semester').notNull(),
  ects: tinyint('ects').notNull(),
  description: text('description'),
  discordChannelId: varchar('discord_channel_id', { length: 32 })
    .notNull()
    .unique(),
  createdAt: now(),
});

export const lecturers = mysqlTable('lecturers', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  title: varchar('title', { length: 50 }),
  email: varchar('email', { length: 200 }),
});

export const subjectLecturers = mysqlTable(
  'subject_lecturers',
  {
    subjectId: int('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    lecturerId: int('lecturer_id')
      .notNull()
      .references(() => lecturers.id, { onDelete: 'cascade' }),
    role: mysqlEnum('role', [
      'wyklad',
      'laboratorium',
      'cwiczenia',
      'projekt',
    ]).notNull(),
  },
  (t) => [primaryKey({ columns: [t.subjectId, t.lecturerId, t.role] })],
);

export const users = mysqlTable('users', {
  id: int('id').autoincrement().primaryKey(),
  discordUserId: varchar('discord_user_id', { length: 32 }).notNull().unique(),
  displayName: varchar('display_name', { length: 100 }).notNull(),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  isBanned: boolean('is_banned').notNull().default(false),
  createdAt: now(),
});

export const topics = mysqlTable('topics', {
  id: int('id').autoincrement().primaryKey(),
  subjectId: int('subject_id')
    .notNull()
    .references(() => subjects.id),
  title: varchar('title', { length: 300 }).notNull(),
  discordThreadId: varchar('discord_thread_id', { length: 32 })
    .notNull()
    .unique(),
  createdBy: int('created_by').references(() => users.id),
  createdAt: now(),
  deletedAt: datetime('deleted_at'),
});

export const tags = mysqlTable('tags', {
  id: int('id').autoincrement().primaryKey(),
  subjectId: int('subject_id')
    .notNull()
    .references(() => subjects.id),
  name: varchar('name', { length: 50 }).notNull(),
  discordTagId: varchar('discord_tag_id', { length: 32 }).notNull().unique(),
});

export const topicTags = mysqlTable(
  'topic_tags',
  {
    topicId: int('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    tagId: int('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.tagId] })],
);

export const materials = mysqlTable(
  'materials',
  {
    id: int('id').autoincrement().primaryKey(),
    topicId: int('topic_id')
      .notNull()
      .references(() => topics.id),
    uploaderId: int('uploader_id')
      .notNull()
      .references(() => users.id),
    discordMessageId: varchar('discord_message_id', { length: 32 }).notNull(),
    discordAttachmentId: varchar('discord_attachment_id', { length: 32 })
      .notNull()
      .unique(),
    originalFilename: varchar('original_filename', { length: 500 }).notNull(),
    // Tokenizable copy of the filename (see searchNameFor) for FULLTEXT.
    searchName: varchar('search_name', { length: 500 }).notNull().default(''),
    mimeType: varchar('mime_type', { length: 150 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    storagePath: varchar('storage_path', { length: 500 }).notNull(),
    previewPath: varchar('preview_path', { length: 500 }),
    previewKind: mysqlEnum('preview_kind', PREVIEW_KINDS).notNull(),
    extractedText: mediumtext('extracted_text'),
    status: mysqlEnum('status', ['pending', 'ready', 'failed'])
      .notNull()
      .default('pending'),
    createdAt: now(),
    deletedAt: datetime('deleted_at'),
  },
  (t) => [
    index('idx_materials_sha256').on(t.sha256),
    index('idx_materials_message').on(t.discordMessageId),
  ],
);

export const jobs = mysqlTable(
  'jobs',
  {
    id: int('id').autoincrement().primaryKey(),
    materialId: int('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    type: mysqlEnum('type', JOB_TYPES).notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'done', 'failed'])
      .notNull()
      .default('queued'),
    attempts: tinyint('attempts').notNull().default(0),
    lastError: text('last_error'),
    runAfter: datetime('run_after').notNull().default(sql`CURRENT_TIMESTAMP`),
    lockedAt: datetime('locked_at'),
  },
  (t) => [index('idx_jobs_status_run_after').on(t.status, t.runAfter)],
);

export const loginTokens = mysqlTable('login_tokens', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: datetime('expires_at').notNull(),
  usedAt: datetime('used_at'),
});

export const sessions = mysqlTable('sessions', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: datetime('expires_at').notNull(),
  createdAt: now(),
});

export const botState = mysqlTable('bot_state', {
  subjectId: int('subject_id')
    .primaryKey()
    .references(() => subjects.id),
  lastSyncedAt: datetime('last_synced_at'),
});

export const PUBLIC_VIEWS = [
  'v_subjects',
  'v_lecturers',
  'v_subject_lecturers',
  'v_topics',
  'v_tags',
  'v_topic_tags',
  'v_materials',
  'v_users',
] as const;

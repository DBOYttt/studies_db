/**
 * Dependency-free constants shared with client bundles. Keep this file free of
 * runtime imports (drizzle, node:*) so client components can import it via
 * `@studies/db/constants` without pulling the table schema into the browser.
 */

export const CLASS_KINDS = [
  'wyklad',
  'laboratorium',
  'cwiczenia',
  'projekt',
  'seminarium',
  'praktyczne',
  'wf',
] as const;
export type ClassKind = (typeof CLASS_KINDS)[number];
/** Class kinds in display order, plus the "none" bucket. */
export const KIND_ORDER: (ClassKind | 'none')[] = [...CLASS_KINDS, 'none'];
export const CLASS_NAMES: Record<ClassKind, string> = {
  wyklad: 'Wykład',
  laboratorium: 'Laboratorium',
  cwiczenia: 'Ćwiczenia',
  projekt: 'Projekt',
  seminarium: 'Seminarium',
  praktyczne: 'Zajęcia praktyczne',
  wf: 'WF',
};

/**
 * Plan block colours per class kind: a muted fill (`bg`) and its ink (`fg`,
 * >= 4.5:1 on bg), for the light and dark themes. Copies of the
 * `--kind-*-bg/fg` variables in apps/web/app/globals.css (the web's source;
 * a web test keeps them equal), used by the bot's plan image.
 */
export const KIND_COLORS: Record<
  'light' | 'dark',
  Record<ClassKind, { bg: string; fg: string }>
> = {
  light: {
    wyklad: { bg: '#e3eef8', fg: '#1d4f78' },
    laboratorium: { bg: '#e4f1e6', fg: '#275c32' },
    cwiczenia: { bg: '#faf0d4', fg: '#7a4f00' },
    projekt: { bg: '#eee8f7', fg: '#533788' },
    seminarium: { bg: '#ddf1ef', fg: '#175a55' },
    praktyczne: { bg: '#f9e7e8', fg: '#8c2e32' },
    wf: { bg: '#f6e8dc', fg: '#7f4119' },
  },
  dark: {
    wyklad: { bg: '#142536', fg: '#9cc6ea' },
    laboratorium: { bg: '#13271a', fg: '#9dd3a7' },
    cwiczenia: { bg: '#2a2109', fg: '#ecca78' },
    projekt: { bg: '#211a33', fg: '#c6b2ec' },
    seminarium: { bg: '#0f2725', fg: '#8dd3cc' },
    praktyczne: { bg: '#2f1619', fg: '#eea6aa' },
    wf: { bg: '#2c1c10', fg: '#eab68a' },
  },
};

/**
 * Exam block colours (exam sessions and egzamin events), like KIND_COLORS:
 * copies of `--exam-bg/fg` in apps/web/app/globals.css (a web test keeps them
 * equal), for the bot's plan image.
 */
export const EXAM_COLORS: Record<'light' | 'dark', { bg: string; fg: string }> =
  {
    light: { bg: '#f6e6f0', fg: '#8a1f5c' },
    dark: { bg: '#2e1325', fg: '#f0a6d3' },
  };

export const ASSESSMENTS = [
  'egzamin',
  'kolokwium',
  'projekt',
  'sprawozdania',
  'zaliczenie',
] as const;
export type Assessment = (typeof ASSESSMENTS)[number];
export const ASSESSMENT_NAMES: Record<Assessment, string> = {
  egzamin: 'Exam',
  kolokwium: 'Test',
  projekt: 'Project',
  sprawozdania: 'Lab reports',
  zaliczenie: 'Credit',
};

export const EVENT_KIND_KEYS = [
  'kolokwium',
  'egzamin',
  'wyjazd',
  'zajecia_dodatkowe',
  'inne',
] as const;
export type EventKind = (typeof EVENT_KIND_KEYS)[number];
export const EVENT_KINDS: Record<
  EventKind,
  { label: string; symbol: string; tag: string }
> = {
  kolokwium: { label: 'Test', tag: 'Kolokwium', symbol: '📝' },
  egzamin: { label: 'Exam', tag: 'Egzamin', symbol: '🎓' },
  wyjazd: { label: 'Trip', tag: 'Wyjazd', symbol: '🚌' },
  zajecia_dodatkowe: {
    label: 'Extra class',
    tag: 'Zajęcia dodatkowe',
    symbol: '➕',
  },
  inne: { label: 'Other', tag: 'Inne', symbol: '📌' },
};
/** Symbol for a recurring series. */
export const SERIES_SYMBOL = '🔁';

/** Weekly marks on a class (or one group of it), see `class_marks`. */
export const CLASS_MARK_KINDS = ['wejsciowka'] as const;
export type ClassMarkKind = (typeof CLASS_MARK_KINDS)[number];

/** `class_sessions.kind`: a regular class or an exam from the timetable feed. */
export const SESSION_KINDS = ['class', 'exam'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

/** Which UniTime feed a class_sessions row came from (each sync only removes its own). */
export const SESSION_SOURCES = ['classes', 'exams'] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

export const PUBLIC_VIEWS = [
  'v_subjects',
  'v_lecturers',
  'v_classes',
  'v_class_groups',
  'v_class_lecturers',
  'v_topics',
  'v_tags',
  'v_topic_tags',
  'v_materials',
  'v_files',
  'v_users',
  'v_class_sessions',
  'v_events',
  'v_class_marks',
  'v_class_mark_skips',
] as const;

export type PublicView = (typeof PUBLIC_VIEWS)[number];

/**
 * Tables the admin SQL console's read-write user may SELECT/INSERT/UPDATE/DELETE,
 * except some columns, see MATERIAL_FILE_COLUMNS, EVENT_LINK_COLUMNS and the
 * Discord link columns (SUBJECT_/TOPIC_/TAG_LINK_COLUMNS).
 */
export const CONTENT_TABLES = [
  'subjects',
  'lecturers',
  'classes',
  'class_groups',
  'class_lecturers',
  'class_sessions',
  'topics',
  'tags',
  'topic_tags',
  'materials',
  'jobs',
  'events',
  'event_series',
  'event_topics',
  'class_marks',
  'class_mark_skips',
] as const;

/**
 * `materials` columns the worker and file routes turn into paths on disk (or
 * that describe the stored file). The console's read-write user may not write
 * them, and may not INSERT into `materials` at all: rows come from the bot.
 */
export const MATERIAL_FILE_COLUMNS = [
  'storage_path',
  'preview_path',
  'sha256',
  'size_bytes',
] as const;

/**
 * `events` / `event_series` columns that point the bot at a Discord thread or
 * at owners. The console's read-write user may neither INSERT nor UPDATE them:
 * the bot unlocks, renames and posts into the thread they lead to.
 */
export const EVENT_LINK_COLUMNS = [
  'topic_id',
  'series_id',
  'created_by',
  'updated_by',
] as const;
export const EVENT_SERIES_LINK_COLUMNS = [
  'topic_id',
  'parent_id',
  'created_by',
] as const;

/**
 * Columns that point the bot at a Discord forum, thread or forum tag. The
 * console's read-write user may neither INSERT nor UPDATE them: catch-up and
 * `/resync` ingest whatever forum `subjects.discord_channel_id` names, and
 * event posts go there too. Only the bot and `/setup` write them.
 */
export const SUBJECT_LINK_COLUMNS = ['discord_channel_id'] as const;
export const TOPIC_LINK_COLUMNS = ['discord_thread_id'] as const;
export const TAG_LINK_COLUMNS = ['discord_tag_id'] as const;

/** Website uploads for events (Discord's attachment limit is the cap). */
export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOADS_PER_HOUR = 30;
/** All files of one upload request (Cloudflare refuses bodies over 100 MB). */
export const MAX_UPLOAD_TOTAL_BYTES = 95 * 1024 * 1024;

/** Most `{ classId, groupId }` pairs one group import saves. */
export const GROUP_IMPORT_MAX_PAIRS = 100;

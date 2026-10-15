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

export const ASSESSMENTS = [
  'egzamin',
  'kolokwium',
  'projekt',
  'sprawozdania',
  'zaliczenie',
] as const;
export type Assessment = (typeof ASSESSMENTS)[number];
export const ASSESSMENT_NAMES: Record<Assessment, string> = {
  egzamin: 'Egzamin',
  kolokwium: 'Kolokwium',
  projekt: 'Projekt',
  sprawozdania: 'Sprawozdania',
  zaliczenie: 'Zaliczenie',
};

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
] as const;

export type PublicView = (typeof PUBLIC_VIEWS)[number];

/**
 * Tables the admin SQL console's read-write user may SELECT/INSERT/UPDATE/DELETE,
 * except `materials`, see MATERIAL_FILE_COLUMNS.
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

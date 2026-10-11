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
] as const;
export type ClassKind = (typeof CLASS_KINDS)[number];
export const CLASS_NAMES: Record<ClassKind, string> = {
  wyklad: 'Wykład',
  laboratorium: 'Laboratorium',
  cwiczenia: 'Ćwiczenia',
  projekt: 'Projekt',
  seminarium: 'Seminarium',
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
] as const;

export type PublicView = (typeof PUBLIC_VIEWS)[number];

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

export const EVENT_KIND_KEYS = [
  'kolokwium',
  'egzamin',
  'wyjazd',
  'zajecia_dodatkowe',
  'inne',
] as const;
export type EventKind = (typeof EVENT_KIND_KEYS)[number];
export const EVENT_KINDS: Record<EventKind, { label: string; symbol: string }> =
  {
    kolokwium: { label: 'Kolokwium', symbol: '📝' },
    egzamin: { label: 'Egzamin', symbol: '🎓' },
    wyjazd: { label: 'Wyjazd', symbol: '🚌' },
    zajecia_dodatkowe: { label: 'Zajęcia dodatkowe', symbol: '➕' },
    inne: { label: 'Inne', symbol: '📌' },
  };
/** Symbol for a recurring series. */
export const SERIES_SYMBOL = '🔁';

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
  'events',
  'event_topics',
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

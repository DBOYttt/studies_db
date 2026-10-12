import type { ClassKind } from '@studies/db/constants';
import { explorerHref } from './explorer';
import type { PublicView } from './tables';

/** Small id -> label lookups (tens of rows) used to build reference links. */
export type LinkContext = {
  subjects: Map<number, string>;
  classes: Map<number, { code: string; kind: ClassKind }>;
  groups: Map<number, { code: string; kind: ClassKind; number: number }>;
};

export const lecturerHref = (id: number) => `/lecturers/${id}`;
export const userHref = (id: number) => `/users/${id}`;
export const tagHref = (id: number) => `/tags/${id}`;
export const topicHref = (id: number) => `/topics/${id}`;

export function subjectHref(ctx: LinkContext, id: number): string | null {
  const code = ctx.subjects.get(id);
  return code === undefined ? null : explorerHref(code, {});
}

export function classHref(ctx: LinkContext, id: number): string | null {
  const c = ctx.classes.get(id);
  return c ? explorerHref(c.code, { classKind: c.kind }) : null;
}

export function groupHref(ctx: LinkContext, id: number): string | null {
  const g = ctx.groups.get(id);
  return g
    ? explorerHref(g.code, { classKind: g.kind, group: g.number })
    : null;
}

type Resolver = (id: number, ctx: LinkContext) => string | null;

const SUBJECT: Resolver = (id, ctx) => subjectHref(ctx, id);
const CLASS: Resolver = (id, ctx) => classHref(ctx, id);
const GROUP: Resolver = (id, ctx) => groupHref(ctx, id);
const LECTURER: Resolver = (id) => lecturerHref(id);
const USER: Resolver = (id) => userHref(id);
const TAG: Resolver = (id) => tagHref(id);
const TOPIC: Resolver = (id) => topicHref(id);

/** Foreign-key columns that link in every view. */
const FK_COLUMNS: Record<string, Resolver> = {
  subject_id: SUBJECT,
  class_id: CLASS,
  group_id: GROUP,
  lecturer_id: LECTURER,
  created_by: USER,
  uploader_id: USER,
  tag_id: TAG,
  topic_id: TOPIC,
};

/** Label columns: resolver applied to the id read from `idCol` of the same row. */
type Label = { idCol: string; resolve: Resolver };
const own = (resolve: Resolver, cols: string[]): Record<string, Label> =>
  Object.fromEntries(cols.map((c) => [c, { idCol: 'id', resolve }]));

const VIEW_LABELS: Partial<Record<PublicView, Record<string, Label>>> = {
  v_subjects: own(SUBJECT, ['id', 'code', 'name']),
  v_classes: own(CLASS, ['id', 'name']),
  v_class_groups: own(GROUP, ['id', 'name']),
  v_lecturers: own(LECTURER, ['id', 'name']),
  v_users: own(USER, ['id', 'display_name']),
  v_tags: own(TAG, ['id', 'name']),
  // subject_name only exists in the entity pages' topic grids.
  v_topics: {
    ...own(TOPIC, ['id', 'title']),
    subject_name: { idCol: 'subject_id', resolve: SUBJECT },
  },
  v_files: {
    subject_code: { idCol: 'subject_id', resolve: SUBJECT },
    subject_name: { idCol: 'subject_id', resolve: SUBJECT },
    class_name: { idCol: 'class_id', resolve: CLASS },
    group_name: { idCol: 'group_id', resolve: GROUP },
    topic_title: { idCol: 'topic_id', resolve: TOPIC },
    uploader: { idCol: 'uploader_id', resolve: USER },
  },
  v_class_sessions: {
    subject_name: { idCol: 'subject_id', resolve: SUBJECT },
    class_name: { idCol: 'class_id', resolve: CLASS },
    group_name: { idCol: 'group_id', resolve: GROUP },
    lecturer_name: { idCol: 'lecturer_id', resolve: LECTURER },
  },
};

function asId(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v === 'bigint')
    return v > 0n && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
  return null;
}

/**
 * Href of cell `col` in `row`, or null. Columns are looked up by name in
 * `columns`, so a column subset just yields no link for missing id columns.
 */
export function cellHref(
  view: PublicView,
  columns: string[],
  row: unknown[],
  col: number,
  ctx: LinkContext,
): string | null {
  const name = columns[col];
  if (name === undefined) return null;
  const label = VIEW_LABELS[view]?.[name];
  if (label) {
    const i = columns.indexOf(label.idCol);
    const id = i >= 0 ? asId(row[i]) : null;
    return id === null ? null : label.resolve(id, ctx);
  }
  const fk = FK_COLUMNS[name];
  if (!fk) return null;
  const id = asId(row[col]);
  return id === null ? null : fk(id, ctx);
}

import { CLASS_KINDS, type ClassKind } from '@studies/db/schema';

export type ExplorerTab = 'explorer' | 'map' | 'schema';

export type ExplorerParams = {
  classKind: ClassKind | 'none' | null;
  group: number | null;
  topic: number | null;
  file: number | null;
  tab: ExplorerTab;
};

type SearchParams = Record<string, string | string[] | undefined>;

const TABS: readonly ExplorerTab[] = ['explorer', 'map', 'schema'];

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function posInt(v: string | undefined): number | null {
  if (v === undefined || !/^\d{1,9}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 ? n : null;
}

export function parseExplorerParams(sp: SearchParams): ExplorerParams {
  const c = one(sp.class);
  const classKind =
    c === 'none' ||
    (c !== undefined && (CLASS_KINDS as readonly string[]).includes(c))
      ? (c as ClassKind | 'none')
      : null;
  const t = one(sp.tab);
  return {
    classKind,
    group: posInt(one(sp.group)),
    topic: posInt(one(sp.topic)),
    file: posInt(one(sp.file)),
    tab: TABS.find((x) => x === t) ?? 'explorer',
  };
}

export const SORT_KEYS = ['topic', 'filename', 'created', 'uploader'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

export type ExplorerFilters = {
  tag: number | null;
  q: string;
  sort: SortKey | null;
  dir: SortDir | null;
};

const MAX_Q = 100;

/** Table filter params with a runtime whitelist for sort/dir (never trust the URL). */
export function parseExplorerFilters(sp: SearchParams): ExplorerFilters {
  const sort = one(sp.sort);
  const dir = one(sp.dir);
  return {
    tag: posInt(one(sp.tag)),
    q: (one(sp.q) ?? '').trim().slice(0, MAX_Q),
    sort: SORT_KEYS.find((k) => k === sort) ?? null,
    dir: dir === 'asc' || dir === 'desc' ? dir : null,
  };
}

/** Param order is stable: class, group, topic, file, tab, tag, q, sort, dir. */
export function explorerHref(
  code: string,
  p: Partial<ExplorerParams>,
  f: Partial<ExplorerFilters> = {},
): string {
  const q = new URLSearchParams();
  if (p.classKind) q.set('class', p.classKind);
  if (p.group != null) q.set('group', String(p.group));
  if (p.topic != null) q.set('topic', String(p.topic));
  if (p.file != null) q.set('file', String(p.file));
  if (p.tab && p.tab !== 'explorer') q.set('tab', p.tab);
  if (f.tag != null) q.set('tag', String(f.tag));
  if (f.q) q.set('q', f.q);
  if (f.sort) q.set('sort', f.sort);
  if (f.dir) q.set('dir', f.dir);
  const s = q.toString();
  return `/subjects/${encodeURIComponent(code)}${s ? `?${s}` : ''}`;
}

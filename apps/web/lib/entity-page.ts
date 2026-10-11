import { parsePreviewId } from './cells';
import { DEFAULT_PER_PAGE } from './result-grid';
import { parseViewParams } from './tables';

type SP = Record<string, string | string[] | undefined>;

/** Route id of entity pages: 1-999999999, anything else is a 404. */
export function parseEntityId(raw: string): number | null {
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
}

/** `?tab=` when it is one of `tabs`, else the first (default) tab. */
export function parseEntityTab<T extends string>(
  sp: SP,
  tabs: readonly T[],
): T {
  const v = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  return tabs.find((t) => t === v) ?? tabs[0];
}

export interface EntityGridParams {
  page: number;
  perPage: number;
  /** As in the URL: undefined = the loader's default order. */
  sort?: string;
  dir?: 'asc' | 'desc';
  preview: number | null;
}

export function parseEntityGrid(sp: SP): EntityGridParams {
  const v = parseViewParams(sp);
  return {
    page: v.page,
    perPage: v.perPage,
    sort: v.sort,
    dir: v.sort ? v.dir : undefined,
    preview: parsePreviewId(sp.preview),
  };
}

/**
 * Query string of the grid on a tab (without preview): every link the grid
 * builds keeps it. `tab` is omitted for the default tab.
 */
export function entityGridQuery(
  tab: string | null,
  g: Pick<EntityGridParams, 'sort' | 'dir' | 'perPage'>,
  page: number,
): string {
  const p = new URLSearchParams();
  if (tab) p.set('tab', tab);
  if (g.sort) {
    p.set('sort', g.sort);
    if (g.dir) p.set('dir', g.dir);
  }
  if (g.perPage !== DEFAULT_PER_PAGE) p.set('per', String(g.perPage));
  if (page > 1) p.set('page', String(page));
  return p.toString();
}

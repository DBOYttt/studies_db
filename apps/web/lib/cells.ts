import type { Cell } from '@/components/DataGrid';

/** Raw driver values -> grid cells (objects such as JSON columns become text). */
export function toCells(rows: unknown[][]): Cell[][] {
  return rows.map((r) =>
    r.map((v) =>
      v === null || v === undefined
        ? null
        : typeof v === 'object'
          ? JSON.stringify(v)
          : (v as Cell),
    ),
  );
}

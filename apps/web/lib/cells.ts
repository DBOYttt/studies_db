import type { Cell } from '@/components/DataGrid';

type RawView = string;

const PREVIEW_COLUMNS: Record<string, { id: string; label: string }> = {
  v_materials: { id: 'id', label: 'original_filename' },
  v_files: { id: 'material_id', label: 'filename' },
};

/** Column holding the material id in views whose rows are files, else null. */
export function previewColumn(view: RawView): string | null {
  return PREVIEW_COLUMNS[view]?.id ?? null;
}

/** `?preview=` value: a positive safe integer, anything else is ignored. */
export function parsePreviewId(
  v: string | string[] | undefined,
): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s || !/^[1-9]\d*$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Raw driver values -> grid cells (objects such as JSON columns become text).
 * With `view`/`columns`, the id and filename cells of file views become
 * `{ text, preview }` cells; the grid builds the link from the numeric id only.
 */
export function toCells(
  rows: unknown[][],
  opts?: { view: RawView; columns: string[] },
): Cell[][] {
  const spec = opts ? PREVIEW_COLUMNS[opts.view] : undefined;
  const idCol = spec && opts ? opts.columns.indexOf(spec.id) : -1;
  const labelCol = spec && opts ? opts.columns.indexOf(spec.label) : -1;
  return rows.map((r) => {
    const raw = idCol >= 0 ? r[idCol] : undefined;
    const id =
      typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0
        ? raw
        : typeof raw === 'bigint' &&
            raw > 0n &&
            raw <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(raw)
          : null;
    return r.map((v, i): Cell => {
      if (v === null || v === undefined) return null;
      if (id !== null && (i === idCol || i === labelCol)) {
        return { text: String(v), preview: id };
      }
      return typeof v === 'object' ? JSON.stringify(v) : (v as Cell);
    });
  });
}

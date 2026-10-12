/** Pure, client-safe helpers of the simple (Prosty) view. */
import type { ClassKind } from '@studies/db/constants';

/**
 * One UTF-16 unit folded like `stripMarks(...).toLowerCase()` of @studies/db
 * (which is not importable client-side), but always 1:1 so hit offsets map
 * straight back onto the original text.
 */
function foldUnit(c: string): string {
  const f = c
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase();
  return f.length === 1 ? f : c;
}

const fold = (s: string) => Array.from(s.split(''), foldUnit).join('');

/** Case- and accent-insensitive split of `text` around all hits of `q`. Never throws. */
export function highlightParts(
  text: string,
  q: string,
): { t: string; hit: boolean }[] {
  const needle = fold(q.trim());
  if (!needle || !text) return [{ t: text, hit: false }];
  const hay = fold(text);
  const parts: { t: string; hit: boolean }[] = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    if (i > from) parts.push({ t: text.slice(from, i), hit: false });
    parts.push({ t: text.slice(i, i + needle.length), hit: true });
    from = i + needle.length;
  }
  if (parts.length === 0) return [{ t: text, hit: false }];
  if (from < text.length) parts.push({ t: text.slice(from), hit: false });
  return parts;
}

export const REPORT_META: { icon: 'Books' | 'Medal' | 'Exam'; desc: string }[] =
  [
    { icon: 'Books', desc: 'Ile materiałów ma każdy przedmiot.' },
    { icon: 'Medal', desc: 'Kto dodał najwięcej plików.' },
    { icon: 'Exam', desc: 'Tematy z tagiem Kolokwium z ostatnich 30 dni.' },
  ];

export const REPORT_LABELS: Record<string, string> = {
  code: 'Kod',
  name: 'Przedmiot',
  materialy: 'Materiały',
  display_name: 'Autor',
  liczba_plikow: 'Pliki',
  id: 'Nr',
  title: 'Temat',
  created_at: 'Dodano',
};

export function fileIcon(kind: 'pdf' | 'image' | 'text' | 'none'): {
  icon: 'FilePdf' | 'FileImage' | 'FileText' | 'File';
  tone: 'red' | 'green' | 'accent' | 'muted';
} {
  switch (kind) {
    case 'pdf':
      return { icon: 'FilePdf', tone: 'red' };
    case 'image':
      return { icon: 'FileImage', tone: 'green' };
    case 'text':
      return { icon: 'FileText', tone: 'accent' };
    default:
      return { icon: 'File', tone: 'muted' };
  }
}

export function statusBadge(
  s: 'pending' | 'ready' | 'failed',
): { label: string; tone: 'warn' | 'err' } | null {
  if (s === 'pending') return { label: 'Przetwarzanie…', tone: 'warn' };
  if (s === 'failed') return { label: 'Podgląd niedostępny', tone: 'err' };
  return null;
}

type Sp = Record<string, string | string[] | undefined>;

function intParam(sp: Sp, key: string): number | null {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v !== undefined && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : null;
}

/** `?class=<kind>&group=<id>&tag=<id>`; anything unknown or foreign becomes null. */
export function parseSimpleFilters(
  sp: Sp,
  kinds: ClassKind[],
  groupsByKind: Record<string, number[]>,
  tagIds: number[],
): { kind: ClassKind | null; group: number | null; tag: number | null } {
  const rawKind = Array.isArray(sp.class) ? sp.class[0] : sp.class;
  const kind = kinds.find((k) => k === rawKind) ?? null;
  const g = intParam(sp, 'group');
  const group =
    kind && g !== null && (groupsByKind[kind] ?? []).includes(g) ? g : null;
  const t = intParam(sp, 'tag');
  return { kind, group, tag: t !== null && tagIds.includes(t) ? t : null };
}

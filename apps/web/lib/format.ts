const dateFmt = new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'medium',
  timeZone: 'Europe/Warsaw',
});

/** Accepts a Date or an ISO string (JSON APIs carry dates as strings). */
export const formatDate = (d: Date | string): string =>
  dateFmt.format(typeof d === 'string' ? new Date(d) : d);

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Polish plural form: pluralPl(n, 'plik', 'pliki', 'plików') ->
 * 1 plik, 2–4 pliki (but 12–14 plików), everything else plików.
 */
export function pluralPl(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 1) return one;
  const d = abs % 10;
  const dd = abs % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
}

/**
 * An external link target from user/DB data: the trimmed URL when it is an
 * absolute http(s) URL, else null (render as plain text). Defence in depth
 * against `javascript:` and other schemes in stored platform links.
 */
export function safeExternalUrl(s: string | null | undefined): string | null {
  const v = s?.trim();
  if (!v || !/^https?:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.host
      ? v
      : null;
  } catch {
    return null;
  }
}

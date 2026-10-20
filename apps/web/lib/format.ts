const dateFmt = new Intl.DateTimeFormat('en-GB', {
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

export { plural } from '@studies/db/text';

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

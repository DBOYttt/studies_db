import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { materials } from '@studies/db';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from './db';
import type { SessionUser } from './session';
import { storageDir } from './storage';

export type ByteRange = { start: number; end: number };

/**
 * Single-range parser. null = no (usable) Range header -> serve whole file;
 * 'invalid' = unsatisfiable/multi-range/malformed -> 416.
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | 'invalid' | null {
  if (header === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return header.trim().startsWith('bytes=') ? 'invalid' : null;
  const [, a, b] = m;
  if (a === '' && b === '') return 'invalid';
  if (a === '') {
    const n = Number(b);
    if (n === 0 || size === 0) return 'invalid';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (!Number.isSafeInteger(start) || start >= size || start > end) {
    return 'invalid';
  }
  return { start, end };
}

export function contentDisposition(
  kind: 'inline' | 'attachment',
  filename: string,
): string {
  const ascii = filename
    .replace(/["\\]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/%/g, '_');
  const star = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${star}`;
}

const SAFE_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const NOSNIFF = { 'X-Content-Type-Options': 'nosniff' };
const notFound = () =>
  new Response('Not found', { status: 404, headers: NOSNIFF });

/**
 * Serves a stored file. Auth is done by the caller (route GET -> requireUser);
 * `user` is taken only to make that dependency explicit in the signature.
 */
export async function handleFileRequest(
  req: Request,
  id: string,
  variant: string,
  _user: SessionUser,
): Promise<Response> {
  if (variant !== 'original' && variant !== 'preview') return notFound();
  if (!/^[1-9]\d{0,9}$/.test(id)) return notFound();

  const [m] = await getDb()
    .select()
    .from(materials)
    .where(and(eq(materials.id, Number(id)), isNull(materials.deletedAt)))
    .limit(1);
  if (!m) return notFound();

  const headers = new Headers({
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
  });
  let rel: string;
  if (variant === 'original') {
    rel = m.storagePath;
    headers.set('Content-Type', m.mimeType || 'application/octet-stream');
    headers.set(
      'Content-Disposition',
      contentDisposition('attachment', m.originalFilename),
    );
  } else {
    if (m.previewKind === 'none') return notFound();
    headers.set(
      'Content-Disposition',
      contentDisposition('inline', m.originalFilename),
    );
    if (m.previewKind === 'pdf') {
      rel = m.previewPath ?? m.storagePath;
      headers.set('Content-Type', 'application/pdf');
    } else if (m.previewKind === 'text') {
      rel = m.previewPath ?? m.storagePath;
      headers.set('Content-Type', 'text/plain; charset=utf-8');
    } else if (m.previewKind === 'image') {
      rel = m.previewPath ?? m.storagePath;
      const mime = m.mimeType.split(';')[0].trim().toLowerCase();
      if (!mime.startsWith('image/')) return notFound();
      headers.set('Content-Type', mime);
      if (!SAFE_IMAGE_MIMES.has(mime)) {
        headers.set(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        );
      }
    } else {
      return notFound();
    }
  }

  const root = resolve(storageDir());
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + sep)) return notFound();
  let size: number;
  try {
    const s = await stat(abs);
    if (!s.isFile()) return notFound();
    size = s.size;
  } catch {
    return notFound();
  }

  const range = parseRange(req.headers.get('range'), size);
  if (range === 'invalid') {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (size === 0) {
    headers.set('Content-Length', '0');
    return new Response(null, { status: 200, headers });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  headers.set('Content-Length', String(end - start + 1));
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  const body = Readable.toWeb(
    createReadStream(abs, { start, end }),
  ) as ReadableStream;
  return new Response(body, { status: range ? 206 : 200, headers });
}

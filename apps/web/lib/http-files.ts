import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { materials, resolveInStorage, topics } from '@studies/db';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from './db';
import { contentSecurityPolicy } from './security-headers';
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

function looksLikePdf(mimeType: string, filename: string): boolean {
  const mime = mimeType.split(';')[0].trim().toLowerCase();
  return mime === 'application/pdf' || /\.pdf$/i.test(filename);
}

async function startsWithPdfMagic(path: string): Promise<boolean> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(5);
    const { bytesRead } = await fh.read(buf, 0, 5, 0);
    return bytesRead === 5 && buf.toString('latin1') === '%PDF-';
  } finally {
    await fh.close();
  }
}

/**
 * Uploader-supplied types a browser would run or render as a document (HTML,
 * XML/XSLT, SVG, scripts, multipart streams). The original is sent as
 * application/octet-stream instead; `attachment` and nosniff already keep it
 * from rendering, this is one more layer.
 */
const ACTIVE_MIME =
  /^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/xsl|[a-z0-9.+-]+\/[a-z0-9.+-]*\+xml|[a-z0-9.+-]+\/(?:x-)?(?:java|ecma|j)script|multipart\/[a-z0-9.+-]+)$/;

export function originalContentType(mimeType: string): string {
  const mime = mimeType.split(';')[0].trim().toLowerCase();
  if (!mime || ACTIVE_MIME.test(mime)) return 'application/octet-stream';
  return mimeType;
}

/** An original never changes for its id: it is stored by its sha256. */
export const ORIGINAL_CACHE = 'private, max-age=31536000, immutable';
/** A preview may change (a pending conversion lands): revalidate by ETag. */
export const PREVIEW_CACHE = 'private, no-cache';

/** Whether an If-None-Match header matches `etag` (weak comparison). */
export function etagMatches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  return header
    .split(',')
    .some((t) => t.trim() === '*' || bare(t) === bare(etag));
}

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

  // A soft-deleted topic hides its files too (as in v_materials / v_files).
  // Only the columns used below: never the (up to 16 MB) extracted_text,
  // which pdf.js range requests would otherwise load each time.
  const [m] = await getDb()
    .select({
      id: materials.id,
      storagePath: materials.storagePath,
      previewPath: materials.previewPath,
      previewKind: materials.previewKind,
      mimeType: materials.mimeType,
      originalFilename: materials.originalFilename,
      sha256: materials.sha256,
    })
    .from(materials)
    .innerJoin(topics, eq(topics.id, materials.topicId))
    .where(
      and(
        eq(materials.id, Number(id)),
        isNull(materials.deletedAt),
        isNull(topics.deletedAt),
      ),
    )
    .limit(1);
  if (!m) return notFound();

  // next.config's global CSP skips /files/ so the sandbox below can win.
  const headers = new Headers({
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    // `private`: never in a shared cache (Cloudflare). A cached file stays in
    // this browser after logout, like any download.
    'Cache-Control': variant === 'original' ? ORIGINAL_CACHE : PREVIEW_CACHE,
    'Content-Security-Policy': contentSecurityPolicy(process.env.NODE_ENV),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  let rel: string;
  let sniffPdf = false;
  if (variant === 'original') {
    rel = m.storagePath;
    headers.set('Content-Type', originalContentType(m.mimeType));
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
      // No converted preview yet (e.g. pending docx): only fall back to the
      // original when it really is a PDF.
      sniffPdf =
        !m.previewPath && !looksLikePdf(m.mimeType, m.originalFilename);
      headers.set('Content-Type', 'application/pdf');
      // The browser's own PDF viewer is a plugin: object-src (or a
      // default-src fallback) in the app CSP would blank "Full screen".
      headers.set('Content-Security-Policy', "frame-ancestors 'none'");
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

  let abs: string;
  try {
    abs = resolveInStorage(storageDir(), rel);
  } catch {
    return notFound();
  }
  let size: number;
  try {
    const s = await stat(abs);
    if (!s.isFile()) return notFound();
    size = s.size;
  } catch {
    return notFound();
  }
  if (sniffPdf && !(await startsWithPdfMagic(abs))) return notFound();

  // Content-addressed: the original's sha256, plus a suffix when a converted
  // preview file is served (so the ETag changes when the conversion lands).
  const etag =
    rel === m.storagePath ? `"${m.sha256}"` : `"${m.sha256}-preview"`;
  headers.set('ETag', etag);
  if (etagMatches(req.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }

  // If-Range with another validator: the client's partial copy is stale,
  // send the whole file.
  const ifRange = req.headers.get('if-range');
  const rangeHeader =
    ifRange === null || ifRange.trim() === etag
      ? req.headers.get('range')
      : null;
  const range = parseRange(rangeHeader, size);
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

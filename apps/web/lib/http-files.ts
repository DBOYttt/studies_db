import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { materials, resolveInStorage, topics } from '@studies/db';
import { and, eq, getTableColumns, isNull } from 'drizzle-orm';
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
  const [m] = await getDb()
    .select(getTableColumns(materials))
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
    'Cache-Control': 'private, no-store',
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

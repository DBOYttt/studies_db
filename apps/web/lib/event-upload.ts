/**
 * POST /api/wydarzenia/[id]/pliki: uploads for an event, from the website.
 *
 * Files are streamed straight to STORAGE_DIR/uploads/<uuid> (a name we
 * generate; nothing user-controlled reaches the path), the 10 MB / 10 file
 * limits are enforced while streaming, and a partial or rejected upload leaves
 * no file behind. The user's filename is stored for display only.
 *
 * The bot posts the files to Discord. Each batch is queued as one
 * `event_upload` request with target `upload:<first upload id>` (unique per
 * batch, so a second batch is never dropped by the one-queued-request-per-
 * target guard); the payload carries `{ eventId, uploadIds }`.
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  BANNED_MESSAGE,
  checkUser,
  type Db,
  enqueueBotRequest,
  getEvent,
  isRefusal,
  resolveInStorage,
  uploadedFilesLastHour,
  webUploads,
  writeAudit,
} from '@studies/db';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOADS_PER_HOUR,
} from '@studies/db/constants';
import busboy from 'busboy';
import { isCrossOrigin } from './same-origin';

export const UPLOAD_ERRORS = {
  origin: 'Nieprawidłowe pochodzenie żądania.',
  notFound: 'Nie znaleziono wydarzenia.',
  storage: 'Przesyłanie plików jest niedostępne.',
  none: 'Nie wybrano plików.',
  count: `Możesz wysłać najwyżej ${MAX_UPLOAD_FILES} plików naraz.`,
  size: `Plik jest za duży (maks. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`,
  empty: 'Plik jest pusty.',
  bad: 'Nieprawidłowe żądanie.',
  rate: `Limit ${MAX_UPLOADS_PER_HOUR} plików na godzinę. Spróbuj później.`,
  busy: 'Poprzednie wysyłanie jeszcze trwa.',
  save: 'Nie udało się zapisać plików.',
} as const;

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: NO_STORE });

/** Body overhead allowed on top of the file bytes (boundaries, headers). */
const BODY_OVERHEAD = 1024 * 1024;
const MAX_NAME = 200;

/**
 * Display name only: the last path segment (either separator), without
 * control and bidi-override characters, at most 200 characters, Unicode kept.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '')
    .trim();
  const chars = Array.from(clean);
  let name = clean;
  if (chars.length > MAX_NAME) {
    // Shorten the stem, keep the extension (when it looks like one).
    const ext = /(\.[^.\s]{1,15})$/.exec(clean)?.[1] ?? '';
    const extLen = Array.from(ext).length;
    name = `${chars
      .slice(0, MAX_NAME - extLen)
      .join('')
      .trim()}${ext}`;
  }
  return name === '' || name === '.' || name === '..' ? 'plik' : name;
}

type Saved = { rel: string; abs: string; name: string; size: number };
type Failure = { status: number; error: string };

/**
 * Users with an upload in flight: one at a time keeps the hourly limit exact.
 * Per process: assumes a single web container (a second one would need a DB
 * lock instead).
 */
const inFlight = new Set<number>();

/** Streams the multipart body to disk. On any failure nothing is left behind. */
async function receiveFiles(
  req: Request,
  root: string,
  maxFiles: number,
  quotaBound: boolean,
): Promise<{ files: Saved[] } | Failure> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data/i.test(contentType) || !req.body) {
    return { status: 400, error: UPLOAD_ERRORS.bad };
  }
  let bb: busboy.Busboy;
  try {
    bb = busboy({
      headers: { 'content-type': contentType },
      defParamCharset: 'utf8',
      limits: {
        files: maxFiles,
        // busboy flags a file when it REACHES this size, so +1 allows exactly 10 MB.
        fileSize: MAX_UPLOAD_BYTES + 1,
        fields: 5,
        fieldSize: 1024,
        parts: MAX_UPLOAD_FILES + 5,
      },
    });
  } catch {
    return { status: 400, error: UPLOAD_ERRORS.bad };
  }
  const src = Readable.fromWeb(req.body as never);
  try {
    await mkdir(resolveInStorage(root, 'uploads'), { recursive: true });
  } catch {
    src.destroy();
    return { status: 503, error: UPLOAD_ERRORS.storage };
  }

  const created: string[] = [];
  const saved: Saved[] = [];
  const writes: Promise<void>[] = [];
  const active = new Set<ReturnType<typeof createWriteStream>>();
  let failure: Failure | null = null;
  let settled = false;

  return new Promise((resolve) => {
    const finish = async () => {
      if (settled) return;
      settled = true;
      await Promise.allSettled(writes);
      if (failure) {
        await Promise.allSettled(created.map((p) => unlink(p)));
        resolve(failure);
      } else if (saved.length === 0) {
        resolve({ status: 400, error: UPLOAD_ERRORS.none });
      } else {
        resolve({ files: saved });
      }
    };
    const abort = (f: Failure) => {
      failure ??= f;
      src.unpipe(bb);
      src.destroy();
      for (const ws of active) ws.destroy();
      void finish();
    };

    bb.on('file', (_field, stream, info) => {
      // A file input left empty still sends a part with no filename.
      if (failure || !info.filename) {
        stream.resume();
        return;
      }
      const displayName = sanitizeFilename(info.filename);
      const rel = `uploads/${randomUUID()}`;
      const abs = resolveInStorage(root, rel);
      const ws = createWriteStream(abs, { flags: 'wx', mode: 0o600 });
      created.push(abs);
      active.add(ws);
      let size = 0;
      stream.on('data', (c: Buffer) => {
        size += c.length;
      });
      stream.on('limit', () =>
        abort({ status: 400, error: UPLOAD_ERRORS.size }),
      );
      ws.on('error', () => abort({ status: 500, error: UPLOAD_ERRORS.save }));
      writes.push(
        new Promise<void>((done) => {
          ws.on('close', () => {
            active.delete(ws);
            if (!failure && !stream.truncated) {
              if (size === 0) {
                abort({ status: 400, error: UPLOAD_ERRORS.empty });
              } else {
                saved.push({
                  rel,
                  abs,
                  name: displayName,
                  size,
                });
              }
            }
            done();
          });
        }),
      );
      stream.pipe(ws);
    });
    bb.on('filesLimit', () =>
      abort(
        quotaBound
          ? { status: 429, error: UPLOAD_ERRORS.rate }
          : { status: 400, error: UPLOAD_ERRORS.count },
      ),
    );
    bb.on('fieldsLimit', () =>
      abort({ status: 400, error: UPLOAD_ERRORS.bad }),
    );
    bb.on('partsLimit', () => abort({ status: 400, error: UPLOAD_ERRORS.bad }));
    bb.on('error', () => abort({ status: 400, error: UPLOAD_ERRORS.bad }));
    bb.on('close', () => void finish());
    src.on('error', () => abort({ status: 400, error: UPLOAD_ERRORS.bad }));
    src.pipe(bb);
  });
}

export interface UploadDeps {
  db: Db;
  /** Absolute storage root, or null when STORAGE_DIR is not configured. */
  storageRoot: string | null;
}

export async function handleEventUpload(
  req: Request,
  user: { id: number },
  rawEventId: string,
  { db, storageRoot }: UploadDeps,
): Promise<Response> {
  if (isCrossOrigin(req)) return fail(403, UPLOAD_ERRORS.origin);
  if (!/^[1-9]\d{0,9}$/.test(rawEventId)) {
    return fail(404, UPLOAD_ERRORS.notFound);
  }
  const eventId = Number(rawEventId);

  // Re-read from the DB: a ban must stop uploads even with a live session.
  const who = await checkUser(db, user.id);
  if (isRefusal(who)) return fail(403, BANNED_MESSAGE);

  const ev = await getEvent(db, eventId);
  if (!ev || ev.deletedAt !== null) return fail(404, UPLOAD_ERRORS.notFound);
  if (!storageRoot) return fail(503, UPLOAD_ERRORS.storage);

  const declared = Number(req.headers.get('content-length'));
  if (
    Number.isFinite(declared) &&
    declared > MAX_UPLOAD_FILES * MAX_UPLOAD_BYTES + BODY_OVERHEAD
  ) {
    return fail(400, UPLOAD_ERRORS.size);
  }

  if (inFlight.has(user.id)) return fail(429, UPLOAD_ERRORS.busy);
  inFlight.add(user.id);
  try {
    const before = await uploadedFilesLastHour(db, user.id);
    if (before >= MAX_UPLOADS_PER_HOUR) return fail(429, UPLOAD_ERRORS.rate);

    const got = await receiveFiles(
      req,
      storageRoot,
      Math.min(MAX_UPLOAD_FILES, MAX_UPLOADS_PER_HOUR - before),
      MAX_UPLOADS_PER_HOUR - before < MAX_UPLOAD_FILES,
    );
    if (!('files' in got)) return fail(got.status, got.error);
    const files = got.files;
    const discard = () => Promise.allSettled(files.map((f) => unlink(f.abs)));

    try {
      const rows = await db.transaction(async (tx) => {
        // Counted again inside the transaction, now with this batch.
        const used = await uploadedFilesLastHour(tx, user.id);
        if (used + files.length > MAX_UPLOADS_PER_HOUR) return null;
        const out: { id: number; name: string; status: 'queued' }[] = [];
        for (const f of files) {
          const [res] = await tx.insert(webUploads).values({
            eventId,
            userId: user.id,
            storagePath: f.rel,
            originalFilename: f.name,
            sizeBytes: f.size,
          });
          out.push({ id: res.insertId, name: f.name, status: 'queued' });
        }
        const ids = out.map((o) => o.id);
        await writeAudit(tx, {
          userId: user.id,
          action: 'event.upload',
          target: String(eventId),
          rowsAffected: ids.length,
          details: {
            source: 'web',
            count: ids.length,
            files: out.map((o) => o.name),
          },
        });
        await enqueueBotRequest(tx, 'event_upload', `upload:${ids[0]}`, {
          eventId,
          uploadIds: ids,
        });
        return out;
      });
      if (!rows) {
        await discard();
        return fail(429, UPLOAD_ERRORS.rate);
      }
      return Response.json({ uploads: rows }, { headers: NO_STORE });
    } catch (err) {
      await discard();
      console.error('event upload failed', err);
      return fail(500, UPLOAD_ERRORS.save);
    }
  } finally {
    inFlight.delete(user.id);
  }
}

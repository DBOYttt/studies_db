import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  type Db,
  fileExtension,
  insertMaterial,
  materials,
  originalRelPath,
  planProcessing,
  upsertUser,
} from '@studies/db';
import { eq } from 'drizzle-orm';
import { resolveForum, upsertTopic } from './sync.js';
import type { DiscordUser, ThreadInfo } from './types.js';

export type AttachmentInput = {
  attachmentId: string;
  messageId: string;
  url: string;
  filename: string;
  contentType: string | null;
  size: number;
  postedAt: Date;
  uploader: DiscordUser;
  thread: ThreadInfo;
  threadOwner: DiscordUser | null;
};

export type IngestDeps = {
  db: Db;
  storageDir: string;
  fetchBody: (url: string) => Promise<ReadableStream<Uint8Array>>;
};

export type IngestResult =
  | 'created'
  | 'duplicate'
  | 'exists'
  | 'ignored'
  | 'failed';

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

export async function ingestAttachment(
  deps: IngestDeps,
  a: AttachmentInput,
): Promise<IngestResult> {
  const { db, storageDir } = deps;
  let tmpPath: string | null = null;
  try {
    if (!(await resolveForum(db, a.thread.forumChannelId))) {
      return 'ignored';
    }
    const [dup] = await db
      .select({ id: materials.id })
      .from(materials)
      .where(eq(materials.discordAttachmentId, a.attachmentId))
      .limit(1);
    if (dup) return 'exists';

    const tmpDir = join(storageDir, 'tmp');
    await mkdir(tmpDir, { recursive: true });
    await mkdir(join(storageDir, 'originals'), { recursive: true });
    tmpPath = join(
      tmpDir,
      `${a.attachmentId}-${randomBytes(6).toString('hex')}`,
    );

    const hash = createHash('sha256');
    let bytes = 0;
    const hasher = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        bytes += chunk.length;
        cb(null, chunk);
      },
    });
    const body = await deps.fetchBody(a.url);
    await pipeline(
      Readable.fromWeb(body as WebReadableStream<Uint8Array>),
      hasher,
      createWriteStream(tmpPath),
    );
    const sha = hash.digest('hex');

    const rel = originalRelPath(sha, fileExtension(a.filename));
    const finalPath = join(storageDir, rel);
    await mkdir(dirname(finalPath), { recursive: true });
    const alreadyOnDisk = await exists(finalPath);
    if (!alreadyOnDisk) {
      await rename(tmpPath, finalPath);
      tmpPath = null;
    }

    const topicId = await upsertTopic(db, a.thread, a.threadOwner);
    if (topicId === null) return 'ignored';
    const uploaderId = await upsertUser(db, a.uploader);
    const mime = a.contentType ?? 'application/octet-stream';
    const plan = planProcessing(a.filename, mime);
    const res = await insertMaterial(
      db,
      {
        topicId,
        uploaderId,
        discordMessageId: a.messageId,
        discordAttachmentId: a.attachmentId,
        originalFilename: a.filename.slice(0, 500),
        mimeType: mime.slice(0, 150),
        sizeBytes: bytes,
        sha256: sha,
        storagePath: rel,
        previewKind: plan.previewKind,
        createdAt: a.postedAt,
      },
      plan.jobs,
    );
    if (res.status === 'exists') return 'exists';
    return alreadyOnDisk ? 'duplicate' : 'created';
  } catch (err) {
    console.error(
      `ingest failed for attachment ${a.attachmentId} (${a.filename}):`,
      err,
    );
    return 'failed';
  } finally {
    if (tmpPath) await unlink(tmpPath).catch(() => {});
  }
}

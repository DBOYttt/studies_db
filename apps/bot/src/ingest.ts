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
  /**
   * Known topic (files the bot itself posts for web uploads): the forum and
   * topic lookups are skipped and the material goes to this topic.
   */
  topicId?: number;
};

/**
 * Bytes per user in a sliding window, kept in memory (a restart forgets it).
 * `tryCharge` records the bytes only when they fit.
 */
export class UserByteQuota {
  private readonly used = new Map<string, { at: number; bytes: number }[]>();
  constructor(
    readonly maxBytes: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryCharge(user: string, bytes: number): boolean {
    const now = this.now();
    const live = (this.used.get(user) ?? []).filter(
      (e) => now - e.at < this.windowMs,
    );
    const total = live.reduce((sum, e) => sum + e.bytes, 0);
    if (total + bytes > this.maxBytes) {
      if (live.length) this.used.set(user, live);
      else this.used.delete(user);
      return false;
    }
    live.push({ at: now, bytes });
    this.used.set(user, live);
    return true;
  }
}

export type IngestLimits = {
  /** Larger attachments are skipped (by declared size) or aborted mid-download. */
  maxFileBytes: number;
  /** Per-uploader volume; files the bot posts for web uploads are not charged. */
  quota: UserByteQuota;
};

const MiB = 1024 * 1024;
/** R3: 50 MiB per file, 500 MiB per user per hour. */
export const DEFAULT_INGEST_LIMITS: IngestLimits = {
  maxFileBytes: 50 * MiB,
  quota: new UserByteQuota(500 * MiB, 60 * 60_000),
};

export type IngestDeps = {
  db: Db;
  storageDir: string;
  fetchBody: (url: string) => Promise<ReadableStream<Uint8Array>>;
  /** Defaults to `DEFAULT_INGEST_LIMITS` (shared by the whole process). */
  limits?: IngestLimits;
};

/** `skipped`: over a size or volume limit, not stored. */
export type IngestResult =
  | 'created'
  | 'duplicate'
  | 'exists'
  | 'ignored'
  | 'skipped'
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
    if (
      a.topicId === undefined &&
      !(await resolveForum(db, a.thread.forumChannelId))
    ) {
      return 'ignored';
    }
    const [dup] = await db
      .select({ id: materials.id })
      .from(materials)
      .where(eq(materials.discordAttachmentId, a.attachmentId))
      .limit(1);
    if (dup) return 'exists';

    const limits = deps.limits ?? DEFAULT_INGEST_LIMITS;
    if (a.size > limits.maxFileBytes) {
      console.warn(
        `skipped attachment ${a.attachmentId} (${a.filename}): ${a.size} bytes is over the ${limits.maxFileBytes}-byte limit`,
      );
      return 'skipped';
    }
    if (
      a.topicId === undefined &&
      !limits.quota.tryCharge(a.uploader.discordUserId, a.size)
    ) {
      console.warn(
        `skipped attachment ${a.attachmentId} (${a.filename}): uploader ${a.uploader.discordUserId} is over the hourly volume limit`,
      );
      return 'skipped';
    }

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
        bytes += chunk.length;
        // The declared size can't be trusted for the body: stop at the cap.
        if (bytes > limits.maxFileBytes) {
          cb(new Error(`body over the ${limits.maxFileBytes}-byte limit`));
          return;
        }
        hash.update(chunk);
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

    const topicId =
      a.topicId ?? (await upsertTopic(db, a.thread, a.threadOwner));
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

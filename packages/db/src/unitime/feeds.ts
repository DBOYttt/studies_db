import { createHash } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { isSemester, type Semester } from '../admin-fields.js';
import type { DbExecutor } from '../client.js';
import { unitimeFeeds } from '../schema.js';
import { importAllowedHosts } from './fetch.js';

const URL_MAX = 500;

/** Hosts an admin may store a feed link for (same list as personal imports). */
export function feedAllowedHosts(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return importAllowedHosts(env);
}

/** Validates a feed link. Errors never echo the link (it carries a secret). */
export function validateFeedUrl(
  raw: string,
  allowedHosts: readonly string[],
): { ok: true; url: string; host: string } | { ok: false; error: string } {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, error: 'Paste a link.' };
  if (text.length > URL_MAX) {
    return {
      ok: false,
      error: `The link is too long (max ${URL_MAX} characters).`,
    };
  }
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: 'That is not a valid link.' };
  }
  if (u.protocol !== 'https:') {
    return { ok: false, error: 'The link must start with https://.' };
  }
  if (u.username !== '' || u.password !== '') {
    return {
      ok: false,
      error: 'The link must not contain a username or password.',
    };
  }
  // The URL parser drops a default port (:443), so look at the raw authority.
  const authority = text.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0] ?? '';
  if (u.port !== '' || /:\d*$/.test(authority)) {
    return { ok: false, error: 'The link must not contain a port number.' };
  }
  const host = u.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) {
    return {
      ok: false,
      error: `Only links on ${allowedHosts[0] ?? 'the configured host'} are allowed.`,
    };
  }
  return { ok: true, url: text, host };
}

/** Shows a feed link without its secret: host plus a short sha256 fingerprint (never any path or query character). */
export function maskFeedUrl(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return '(invalid link)';
  }
  const tag = createHash('sha256').update(url).digest('hex').slice(0, 6);
  return `${host}/…#${tag}`;
}

export interface StoredFeed {
  semester: Semester;
  classUrl: string;
  examUrl: string | null;
  updatedAt: Date;
  updatedBy: number | null;
}

export async function listFeeds(db: DbExecutor): Promise<StoredFeed[]> {
  const rows = await db
    .select()
    .from(unitimeFeeds)
    .orderBy(asc(unitimeFeeds.semester));
  return rows
    .filter((r) => isSemester(r.semester))
    .map((r) => ({
      semester: r.semester as Semester,
      classUrl: r.classUrl,
      examUrl: r.examUrl,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
    }));
}

export async function setFeed(
  db: DbExecutor,
  input: {
    semester: Semester;
    classUrl?: string;
    examUrl?: string | null;
    userId: number;
  },
  allowedHosts: readonly string[] = feedAllowedHosts(),
): Promise<
  | { ok: true; classHost: string; examHost: string | null }
  | { ok: false; field: 'class_url' | 'exam_url'; error: string }
> {
  return db.transaction(async (tx) => {
    const [stored] = await tx
      .select()
      .from(unitimeFeeds)
      .where(eq(unitimeFeeds.semester, input.semester));

    let classUrl: string;
    if (input.classUrl !== undefined) {
      const v = validateFeedUrl(input.classUrl, allowedHosts);
      if (!v.ok) return { ok: false, field: 'class_url', error: v.error };
      classUrl = v.url;
    } else if (stored) {
      classUrl = stored.classUrl;
    } else {
      return {
        ok: false,
        field: 'class_url',
        error: 'Paste the class timetable link.',
      };
    }

    let examUrl: string | null;
    if (input.examUrl === undefined) {
      examUrl = stored?.examUrl ?? null;
    } else if (input.examUrl === null) {
      examUrl = null;
    } else {
      const v = validateFeedUrl(input.examUrl, allowedHosts);
      if (!v.ok) return { ok: false, field: 'exam_url', error: v.error };
      examUrl = v.url;
    }

    const now = new Date();
    await tx
      .insert(unitimeFeeds)
      .values({
        semester: input.semester,
        classUrl,
        examUrl,
        updatedAt: now,
        updatedBy: input.userId,
      })
      .onDuplicateKeyUpdate({
        set: { classUrl, examUrl, updatedAt: now, updatedBy: input.userId },
      });

    return {
      ok: true,
      classHost: new URL(classUrl).hostname.toLowerCase(),
      examHost: examUrl ? new URL(examUrl).hostname.toLowerCase() : null,
    };
  });
}

export async function clearFeed(
  db: DbExecutor,
  semester: Semester,
): Promise<boolean> {
  const [res] = await db
    .delete(unitimeFeeds)
    .where(eq(unitimeFeeds.semester, semester));
  return res.affectedRows > 0;
}

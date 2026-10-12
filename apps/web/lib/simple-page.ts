import type { Db } from '@studies/db';
import { getMaterialFile, type PreviewFile } from './queries';
import { parseFileParam } from './simple';
import type { SubjectCard } from './simple-queries';

type Sp = Record<string, string | string[] | undefined>;

/** Sidebar rows of the simple shell. */
export const navSubjects = (cards: SubjectCard[]) =>
  cards.map((c) => ({ code: c.code, name: c.name, count: c.fileCount }));

/**
 * The file opened by `?file=<id>` with its subject's name, or null when the
 * param is missing/junk or the material is unknown or deleted (no panel).
 */
export async function loadSimplePreview(
  db: Db,
  sp: Sp,
  cards: SubjectCard[],
): Promise<{ file: PreviewFile; subjectName: string } | null> {
  const id = parseFileParam(sp);
  if (id === null) return null;
  const f = await getMaterialFile(db, id);
  if (!f) return null;
  return {
    file: { ...f, createdAt: f.createdAt.toISOString() },
    subjectName:
      cards.find((c) => c.code === f.subjectCode)?.name ?? f.subjectCode,
  };
}

/** SimpleFile rows with ISO dates (safe to hand to client components). */
export const isoFiles = <T extends { createdAt: Date }>(rows: T[]) =>
  rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));

import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { type JobType, searchNameFor } from './files.js';
import { jobs, materials } from './schema.js';

export type NewMaterial = Omit<typeof materials.$inferInsert, 'searchName'>;

// drizzle wraps driver errors in DrizzleQueryError, so check the cause chain too.
function isDuplicateEntry(err: unknown): boolean {
  for (
    let e = err as { code?: string; cause?: unknown } | undefined;
    e;
    e = e.cause as typeof e
  ) {
    if (e.code === 'ER_DUP_ENTRY') return true;
  }
  return false;
}

export async function insertMaterial(
  db: Db,
  values: NewMaterial,
  jobTypes: JobType[],
): Promise<{ status: 'created' | 'exists'; materialId: number }> {
  try {
    const materialId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(materials)
        .values({
          ...values,
          searchName: searchNameFor(values.originalFilename),
          status:
            jobTypes.length === 0 ? 'ready' : (values.status ?? 'pending'),
        })
        .$returningId();
      if (jobTypes.length > 0) {
        await tx
          .insert(jobs)
          .values(jobTypes.map((type) => ({ materialId: row.id, type })));
      }
      return row.id;
    });
    return { status: 'created', materialId };
  } catch (err) {
    if (isDuplicateEntry(err)) {
      const [existing] = await db
        .select({ id: materials.id })
        .from(materials)
        .where(eq(materials.discordAttachmentId, values.discordAttachmentId));
      if (existing) return { status: 'exists', materialId: existing.id };
    }
    throw err;
  }
}

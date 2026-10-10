import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createLoginToken,
  insertMaterial,
  subjects,
  tags,
  topics,
  topicTags,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { E2E_STORAGE_DIR } from '../playwright.config';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export default async function globalSetup() {
  rmSync(E2E_STORAGE_DIR, { recursive: true, force: true });
  mkdirSync(E2E_STORAGE_DIR, { recursive: true });
  for (const f of ['sample.pdf', 'sample.docx', 'sample.pptx']) {
    copyFileSync(join(fixtures, f), join(E2E_STORAGE_DIR, f));
  }

  const db = await resetTestDb();
  try {
    const userId = await upsertUser(db, {
      discordUserId: 'e2e-user',
      displayName: 'Ewa Testowa',
      avatarUrl: null,
    });
    const [{ id: subjectId }] = await db
      .insert(subjects)
      .values({
        name: 'Fizyka techniczna',
        code: 'FIZ',
        semester: 1,
        ects: 5,
        discordChannelId: 'e2e-ch',
      })
      .$returningId();
    const [{ id: topicId }] = await db
      .insert(topics)
      .values({
        subjectId,
        title: 'Kolokwium 1 — tarcie',
        discordThreadId: 'e2e-thread',
        createdBy: userId,
      })
      .$returningId();
    const [{ id: tagId }] = await db
      .insert(tags)
      .values({ subjectId, name: 'Kolokwium', discordTagId: 'e2e-tag' })
      .$returningId();
    await db.insert(topicTags).values({ topicId, tagId });

    const base = {
      topicId,
      uploaderId: userId,
      sha256: '0'.repeat(64),
    };
    await insertMaterial(
      db,
      {
        ...base,
        discordMessageId: 'm1',
        discordAttachmentId: 'a1',
        originalFilename: 'sample.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        storagePath: 'sample.pdf',
        previewKind: 'pdf',
        status: 'ready',
        extractedText:
          'Wstęp. Współczynnik tarcia: tarcie statyczne jest większe od kinetycznego.',
      },
      [],
    );
    await insertMaterial(
      db,
      {
        ...base,
        discordMessageId: 'm2',
        discordAttachmentId: 'a2',
        originalFilename: 'notatki.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 1,
        storagePath: 'sample.docx',
        previewKind: 'pdf',
      },
      ['convert', 'extract_text'], // jobs queued, status stays pending
    );
    const failed = await insertMaterial(
      db,
      {
        ...base,
        discordMessageId: 'm3',
        discordAttachmentId: 'a3',
        originalFilename: 'prezentacja.pptx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        sizeBytes: 1,
        storagePath: 'sample.pptx',
        previewKind: 'pdf',
      },
      ['convert'],
    );
    const { materials } = await import('@studies/db');
    const { eq } = await import('drizzle-orm');
    await db
      .update(materials)
      .set({ status: 'failed' })
      .where(eq(materials.id, failed.materialId));

    process.env.E2E_TOKEN = await createLoginToken(db, userId);
  } finally {
    await closeTestDb(db);
  }
}

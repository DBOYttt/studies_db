import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classLecturers,
  createLoginToken,
  ensureClass,
  ensureGroup,
  insertMaterial,
  lecturers,
  subjects,
  tags,
  topics,
  topicTags,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { E2E_STORAGE_DIR } from '../playwright.config';
import { E2E_SESSION_DIR } from './session';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export default async function globalSetup() {
  rmSync(E2E_STORAGE_DIR, { recursive: true, force: true });
  mkdirSync(E2E_STORAGE_DIR, { recursive: true });
  rmSync(E2E_SESSION_DIR, { recursive: true, force: true });
  mkdirSync(E2E_SESSION_DIR, { recursive: true });
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

    // Second subject with a real hierarchy for explorer.spec.ts.
    const [{ id: mechId }] = await db
      .insert(subjects)
      .values({
        name: 'Mechanika',
        code: 'MECH',
        semester: 2,
        ects: 4,
        description: 'Statyka i dynamika <b>brył</b>',
        discordChannelId: 'e2e-ch-mech',
      })
      .$returningId();
    const labId = await ensureClass(db, mechId, 'laboratorium');
    const gr3Id = await ensureGroup(db, labId, 3);
    const wykladId = await ensureClass(db, mechId, 'wyklad');
    const mkTopic = async (
      title: string,
      thread: string,
      classId: number | null,
      groupId: number | null,
    ) => {
      const [{ id }] = await db
        .insert(topics)
        .values({
          subjectId: mechId,
          title,
          discordThreadId: thread,
          createdBy: userId,
          classId,
          groupId,
        })
        .$returningId();
      return id;
    };
    const labTopic = await mkTopic(
      'Sprawozdanie z ćwiczenia',
      'e2e-t-lab',
      labId,
      gr3Id,
    );
    await mkTopic('Wprowadzenie do dynamiki', 'e2e-t-wyklad', wykladId, null);
    await mkTopic('Luźne notatki', 'e2e-t-none', null, null);
    await insertMaterial(
      db,
      {
        topicId: labTopic,
        uploaderId: userId,
        sha256: '1'.repeat(64),
        discordMessageId: 'mm1',
        discordAttachmentId: 'ma1',
        originalFilename: 'lab-sprawozdanie.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        storagePath: 'sample.pdf',
        previewKind: 'pdf',
        status: 'ready',
        extractedText: 'Sprawozdanie z laboratorium.',
      },
      [],
    );

    // Lab gr 2 with its own topic and file (not visible to gr 3's lecturer).
    const gr2Id = await ensureGroup(db, labId, 2);
    const gr2Topic = await mkTopic(
      'Sprawozdanie gr 2',
      'e2e-t-lab-gr2',
      labId,
      gr2Id,
    );
    await insertMaterial(
      db,
      {
        topicId: gr2Topic,
        uploaderId: userId,
        sha256: '2'.repeat(64),
        discordMessageId: 'mm2',
        discordAttachmentId: 'ma2',
        originalFilename: 'lab-gr2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        storagePath: 'sample.pdf',
        previewKind: 'pdf',
        status: 'ready',
      },
      [],
    );

    // Lecturers for entities.spec.ts.
    const mkLecturer = async (title: string, name: string, email: string) => {
      const [{ id }] = await db
        .insert(lecturers)
        .values({ title, name, email })
        .$returningId();
      return id;
    };
    const nowak = await mkLecturer(
      'dr',
      'Anna Nowak',
      'anna.nowak@example.edu',
    );
    const kowalski = await mkLecturer(
      'prof.',
      'Jan Kowalski',
      'jan.kowalski@example.edu',
    );
    const lis = await mkLecturer('mgr', 'Ewa Lis', 'ewa.lis@example.edu');
    await db.insert(classLecturers).values([
      { classId: labId, lecturerId: nowak, groupId: gr3Id },
      { classId: wykladId, lecturerId: kowalski, groupId: null },
      { classId: labId, lecturerId: lis, groupId: gr2Id },
    ]);

    process.env.E2E_TOKEN = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_EXPLORER = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_ENTITIES = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_SCHEMA = await createLoginToken(db, userId);
  } finally {
    await closeTestDb(db);
  }
}

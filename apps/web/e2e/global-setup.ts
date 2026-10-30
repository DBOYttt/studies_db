import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addMark,
  botRequests,
  classes,
  classLecturers,
  classSessions,
  createLoginToken,
  ensureClass,
  ensureGroup,
  events,
  insertMaterial,
  lecturers,
  subjects,
  tags,
  topics,
  topicTags,
  upsertUser,
  users,
  writeAudit,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
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
    const wykladTopic = await mkTopic(
      'Wprowadzenie do dynamiki',
      'e2e-t-wyklad',
      wykladId,
      null,
    );
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

    await insertMaterial(
      db,
      {
        topicId: wykladTopic,
        uploaderId: userId,
        sha256: '3'.repeat(64),
        discordMessageId: 'mm3',
        discordAttachmentId: 'ma3',
        originalFilename: 'wyklad-slajdy.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        storagePath: 'sample.pdf',
        previewKind: 'pdf',
        status: 'ready',
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

    // Plan zajęć (plan.spec.ts): subject PLAN with sessions in 2026-W42.
    const [{ id: planId }] = await db
      .insert(subjects)
      .values({
        name: 'Plan testowy',
        code: 'PLAN',
        semester: 3,
        ects: 3,
        platformUrl: 'https://upel.example.edu/course/plan',
        discordChannelId: 'e2e-ch-plan',
      })
      .$returningId();
    const planWyklad = await ensureClass(db, planId, 'wyklad');
    const planCw = await ensureClass(db, planId, 'cwiczenia');
    await db
      .update(classes)
      .set({ platformUrl: 'https://platforma.example.edu/cwiczenia' })
      .where(eq(classes.id, planCw));
    const cwGr1 = await ensureGroup(db, planCw, 1);
    const cwGr2 = await ensureGroup(db, planCw, 2);
    const [{ id: planLecturer }] = await db
      .insert(lecturers)
      .values({
        title: 'dr',
        name: 'Piotr Planista',
        email: 'piotr.planista@example.edu',
        officeHours: 'wt. 13:00-14:00',
        room: 'C-3 305',
      })
      .$returningId();
    await db
      .insert(classLecturers)
      .values({ classId: planWyklad, lecturerId: planLecturer, groupId: null });
    const wall = (d: number, h: number, m = 0) =>
      new Date(Date.UTC(2026, 9, d, h, m));
    const session = (
      uid: string,
      subjectId: number,
      classId: number | null,
      groupId: number | null,
      lecturerId: number | null,
      label: string,
      room: string,
      start: Date,
      end: Date,
    ) => ({
      uid,
      occurrenceStart: start,
      subjectId,
      classId,
      groupId,
      lecturerId,
      label,
      room,
      startsAt: start,
      endsAt: end,
    });
    await db
      .insert(classSessions)
      .values([
        session(
          'e2e-wyklad',
          planId,
          planWyklad,
          null,
          planLecturer,
          'Wykład 1',
          'A-1 101',
          wall(12, 8),
          wall(12, 9, 30),
        ),
        session(
          'e2e-cw-g1',
          planId,
          planCw,
          cwGr1,
          null,
          'Ćwiczenia gr 1',
          'B-2 201',
          wall(13, 10),
          wall(13, 11, 30),
        ),
        session(
          'e2e-cw-g2',
          planId,
          planCw,
          cwGr2,
          null,
          'Ćwiczenia gr 2',
          'B-2 202',
          wall(13, 12),
          wall(13, 13, 30),
        ),
        session(
          'e2e-fiz',
          subjectId,
          null,
          null,
          null,
          'Fizyka inna',
          'D-4 404',
          wall(14, 14),
          wall(14, 15, 30),
        ),
      ]);

    // Timetable assessments (plan.spec.ts): subject OCEN in 2026-W40/W41
    // with a Test inside the lab Gr. 1 session, an entry quiz on the lab
    // and an imported exam.
    const [{ id: ocenId }] = await db
      .insert(subjects)
      .values({
        name: 'Ocenianie',
        code: 'OCEN',
        semester: 3,
        ects: 2,
        discordChannelId: 'e2e-ch-ocen',
      })
      .$returningId();
    const ocenLab = await ensureClass(db, ocenId, 'laboratorium');
    const ocenGr1 = await ensureGroup(db, ocenLab, 1);
    const ocenGr2 = await ensureGroup(db, ocenLab, 2);
    await db.insert(classSessions).values([
      session(
        'e2e-ocen-w40',
        ocenId,
        ocenLab,
        ocenGr1,
        null,
        'Laboratorium gr 1',
        'E-5 500',
        wall(-1, 10), // Tue 29 Sep
        wall(-1, 11, 30),
      ),
      session(
        'e2e-ocen-g1',
        ocenId,
        ocenLab,
        ocenGr1,
        null,
        'Laboratorium gr 1',
        'E-5 501',
        wall(6, 10),
        wall(6, 11, 30),
      ),
      session(
        'e2e-ocen-g2',
        ocenId,
        ocenLab,
        ocenGr2,
        null,
        'Laboratorium gr 2',
        'E-5 502',
        wall(7, 12),
        wall(7, 13, 30),
      ),
      {
        ...session(
          'e2e-ocen-exam',
          ocenId,
          null,
          null,
          null,
          'Egzamin',
          'Aula E',
          wall(9, 9),
          wall(9, 11),
        ),
        kind: 'exam' as const,
        source: 'exams' as const,
      },
    ]);
    // Two tests in the 29 Sep session: one "2 tests" badge.
    for (const [title, m] of [
      ['Kolokwium A', 15],
      ['Kolokwium B', 45],
    ] as const) {
      await db.insert(events).values({
        kind: 'kolokwium',
        title,
        subjectId: ocenId,
        classId: ocenLab,
        groupId: null,
        startsAt: wall(-1, 10, m),
        endsAt: wall(-1, 11),
        createdBy: userId,
        updatedBy: userId,
      });
    }
    await db.insert(events).values({
      kind: 'kolokwium',
      title: 'Kolokwium z ocen',
      subjectId: ocenId,
      classId: ocenLab,
      groupId: ocenGr1,
      startsAt: wall(6, 10, 15),
      endsAt: wall(6, 11),
      createdBy: userId,
      updatedBy: userId,
    });
    // An egzamin event at the imported exam: merged into its block.
    await db.insert(events).values({
      kind: 'egzamin',
      title: 'Egzamin z ocen',
      subjectId: ocenId,
      startsAt: wall(9, 9),
      endsAt: wall(9, 11),
      createdBy: userId,
      updatedBy: userId,
    });
    const quiz = await addMark(
      db,
      userId,
      {
        classId: ocenLab,
        groupId: null,
        kind: 'wejsciowka',
        note: 'Rozdział 2',
      },
      'web',
    );
    if (!quiz.ok) throw new Error(`e2e entry quiz: ${quiz.message}`);

    // Editing assessments (events.spec.ts): subject SESJ with upcoming lab
    // sessions 7 and 14 days ahead (dates as the spec's `dateIn`).
    const [{ id: sesjId }] = await db
      .insert(subjects)
      .values({
        name: 'Sesje testowe',
        code: 'SESJ',
        semester: 3,
        ects: 2,
        discordChannelId: 'e2e-ch-sesj',
      })
      .$returningId();
    const sesjLab = await ensureClass(db, sesjId, 'laboratorium');
    const sesjGr1 = await ensureGroup(db, sesjLab, 1);
    const ahead = (days: number, h: number, m = 0) => {
      const d = new Date(Date.now() + days * 86_400_000);
      return new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m),
      );
    };
    await db
      .insert(classSessions)
      .values([
        session(
          'e2e-sesj-1',
          sesjId,
          sesjLab,
          sesjGr1,
          null,
          'Laboratorium gr 1',
          'F-6 601',
          ahead(7, 14),
          ahead(7, 15, 30),
        ),
        session(
          'e2e-sesj-2',
          sesjId,
          sesjLab,
          sesjGr1,
          null,
          'Laboratorium gr 1',
          'F-6 601',
          ahead(14, 14),
          ahead(14, 15, 30),
        ),
      ]);

    // Timetable layout (plan-layout.spec.ts): subject UKL in 2026-W39 with
    // an entry quiz + Test on a 90-min block beside an event (2 columns), a
    // quiz + Test on a 105-min block, a quiz-only block beside a lecture,
    // a Friday lecture, weekend events (7 day columns) and a lecture today
    // (current week).
    const [{ id: uklId }] = await db
      .insert(subjects)
      .values({
        name: 'Układ zajęć',
        code: 'UKL',
        semester: 3,
        ects: 2,
        discordChannelId: 'e2e-ch-ukl',
      })
      .$returningId();
    const uklLab = await ensureClass(db, uklId, 'laboratorium');
    const uklGr1 = await ensureGroup(db, uklLab, 1);
    const uklGr2 = await ensureGroup(db, uklLab, 2);
    const uklWyklad = await ensureClass(db, uklId, 'wyklad');
    const uklLecturer = await mkLecturer(
      'dr',
      'Lena Układowa',
      'lena.ukladowa@example.edu',
    );
    const sep = (d: number, h: number, m = 0) =>
      new Date(Date.UTC(2026, 8, d, h, m));
    // Today's wall date in Warsaw, as the timetable computes it.
    const [ty, tm, td] = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Warsaw',
    })
      .format(new Date())
      .split('-')
      .map(Number);
    const today = (h: number, m = 0) =>
      new Date(Date.UTC(ty, tm - 1, td, h, m));
    await db.insert(classSessions).values([
      session(
        'e2e-ukl-a',
        uklId,
        uklLab,
        uklGr1,
        uklLecturer,
        'Laboratorium gr 1',
        'U-1 101',
        sep(22, 10),
        sep(22, 11, 30),
      ),
      session(
        'e2e-ukl-b',
        uklId,
        uklLab,
        uklGr1,
        uklLecturer,
        'Laboratorium gr 1',
        'U-1 102',
        sep(23, 12),
        sep(23, 13, 45),
      ),
      session(
        'e2e-ukl-c',
        uklId,
        uklLab,
        uklGr2,
        uklLecturer,
        'Laboratorium gr 2',
        'U-1 103',
        sep(24, 8),
        sep(24, 9, 30),
      ),
      session(
        'e2e-ukl-d',
        uklId,
        uklWyklad,
        null,
        uklLecturer,
        'Wykład',
        'U-1 104',
        sep(24, 8),
        sep(24, 9, 30),
      ),
      // Friday: the panel slides over the left side for it.
      session(
        'e2e-ukl-fri',
        uklId,
        uklWyklad,
        null,
        uklLecturer,
        'Wykład',
        'U-1 106',
        sep(25, 10),
        sep(25, 11, 30),
      ),
      session(
        'e2e-ukl-today',
        uklId,
        uklWyklad,
        null,
        uklLecturer,
        'Wykład',
        'U-1 105',
        today(12),
        today(13, 30),
      ),
    ]);
    const uklEvent = (
      kind: 'kolokwium' | 'inne',
      title: string,
      start: Date,
      end: Date,
      groupId: number | null = null,
    ) => ({
      kind,
      title,
      subjectId: uklId,
      classId: kind === 'kolokwium' ? uklLab : null,
      groupId,
      startsAt: start,
      endsAt: end,
      createdBy: userId,
      updatedBy: userId,
    });
    await db
      .insert(events)
      .values([
        uklEvent(
          'kolokwium',
          'Kolokwium układu',
          sep(22, 10, 15),
          sep(22, 11),
          uklGr1,
        ),
        uklEvent(
          'kolokwium',
          'Kolokwium drugie',
          sep(23, 12, 15),
          sep(23, 13),
          uklGr1,
        ),
        uklEvent('inne', 'Konsultacje', sep(22, 10), sep(22, 11)),
        uklEvent('inne', 'Sobotni wyjazd', sep(26, 9), sep(26, 12)),
        uklEvent('inne', 'Niedzielne konsultacje', sep(27, 10), sep(27, 11)),
      ]);
    const uklQuiz = await addMark(
      db,
      userId,
      {
        classId: uklLab,
        groupId: null,
        kind: 'wejsciowka',
        note: 'Rozdział 5',
      },
      'web',
    );
    if (!uklQuiz.ok) throw new Error(`e2e UKL entry quiz: ${uklQuiz.message}`);

    // Audit log (admin.spec.ts) and mobile pages (mobile.spec.ts): an event
    // far ahead, with its event.add audit row.
    const [{ id: auditEventId }] = await db
      .insert(events)
      .values({
        kind: 'kolokwium',
        title: 'Kolokwium audytu',
        subjectId,
        startsAt: new Date(Date.UTC(2027, 0, 26, 10)),
        endsAt: new Date(Date.UTC(2027, 0, 26, 11)),
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();
    await writeAudit(db, {
      userId,
      action: 'event.add',
      target: String(auditEventId),
      details: { source: 'web' },
    });
    process.env.E2E_AUDIT_EVENT_ID = String(auditEventId);
    process.env.E2E_TOKEN_MOBILE = await createLoginToken(db, userId);

    process.env.E2E_TOKEN = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_EXPLORER = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_ENTITIES = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_PLAN = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_SIMPLE = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_SIMPLE_LANDING = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_SCHEMA = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_NONADMIN = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_EVENTS = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_HEADERS = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_PLAN_LAYOUT = await createLoginToken(db, userId);
    process.env.E2E_TOKEN_DEAD_ENDS = await createLoginToken(db, userId);

    // Moje grupy stored per user (my-groups.spec.ts): its own user, so the
    // saved choice cannot leak into the other specs.
    const groupsUserId = await upsertUser(db, {
      discordUserId: 'e2e-groups',
      displayName: 'Grażyna Grupowa',
      avatarUrl: null,
    });
    process.env.E2E_TOKEN_GROUPS = await createLoginToken(db, groupsUserId);

    // Import from UniTime (group-import.spec.ts): a subject matched by its
    // UniTime name, with Cwiczenia groups 1-2 (one session), and its own user.
    const [{ id: chemId }] = await db
      .insert(subjects)
      .values({
        name: 'Chemia ogólna',
        code: 'CHEM',
        semester: 1,
        ects: 4,
        discordChannelId: 'e2e-ch-chem',
        unitimeName: 'Chemia ogólna (1rok)',
      })
      .$returningId();
    const chemCw = await ensureClass(db, chemId, 'cwiczenia');
    await ensureGroup(db, chemCw, 1);
    const chemGr2 = await ensureGroup(db, chemCw, 2);
    // My groups lists only classes with sessions: one, far from other specs' weeks.
    await db
      .insert(classSessions)
      .values(
        session(
          'e2e-chem-cw',
          chemId,
          chemCw,
          chemGr2,
          null,
          'Ćwiczenia gr 2',
          'D-8 318',
          new Date(Date.UTC(2027, 2, 2, 8, 45)),
          new Date(Date.UTC(2027, 2, 2, 9, 45)),
        ),
      );
    const importUserId = await upsertUser(db, {
      discordUserId: 'e2e-import',
      displayName: 'Iza Importowa',
      avatarUrl: null,
    });
    process.env.E2E_TOKEN_IMPORT = await createLoginToken(db, importUserId);

    // Admin panel (admin.spec.ts): a user flagged is_admin.
    const adminId = await upsertUser(db, {
      discordUserId: 'e2e-admin',
      displayName: 'Adam Administrator',
      avatarUrl: null,
    });
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, adminId));
    process.env.E2E_TOKEN_ADMIN = await createLoginToken(db, adminId);
    process.env.E2E_TOKEN_EVENTS_ADMIN = await createLoginToken(db, adminId);
    process.env.E2E_TOKEN_ADMIN_SIMPLE = await createLoginToken(db, adminId);
    // Sync tab report page (admin-round2.spec.ts): a finished resync with a
    // short report.
    const [adminReq] = await db.insert(botRequests).values({
      kind: 'resync',
      target: 'guild',
      status: 'done',
      payload: { requestedBy: adminId },
      report: 'E2E resync report\n<b>not markup</b>\n',
      startedAt: new Date(Date.now() - 120_000),
      finishedAt: new Date(Date.now() - 60_000),
    });
    process.env.E2E_ADMIN_REQUEST_ID = String(adminReq.insertId);
    // Admin Users tab (admin-round2.spec.ts): blocked and unblocked there,
    // so it never signs in (blocking deletes the user's sessions).
    await upsertUser(db, {
      discordUserId: 'e2e-blockable',
      displayName: 'Bartek Blokowany',
      avatarUrl: null,
    });
  } finally {
    await closeTestDb(db);
  }
}

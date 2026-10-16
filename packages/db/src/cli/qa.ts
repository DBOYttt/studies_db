// QA sandbox for the persona agents (.claude/agents/qa-*.md, /qa-run):
//   qa.ts sandbox          reset `studies_qa_test`, seed example data, add the
//                          persona users and a few events
//   qa.ts login <persona>  print a one-time login link for that persona
// Isolated from dev data (`studies`), the test suite (`studies_test`) and e2e
// (:3100): the database name ends in `_qa_test`, files live in `.qa/storage`
// and the web server (`pnpm qa:serve`) listens on :3200.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { createLoginToken, upsertUser } from '../auth.js';
import { createDb } from '../client.js';
import { addSeries } from '../event-series.js';
import { addEvent } from '../events.js';
import { subjects, users } from '../schema.js';
import { closeTestDb, resetTestDb } from '../testing.js';

export const QA_PORT = 3200;
export const QA_BASE_URL = `http://localhost:${QA_PORT}`;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const QA_STORAGE_DIR = join(repoRoot, '.qa/storage');

/** Personas: login id → display name, flags. */
export const QA_PERSONAS = {
  student: { name: 'Ola Studentka' },
  novice: { name: 'Pan Zenon' },
  admin: { name: 'Adam Starosta', admin: true },
  curator: { name: 'Ula Kuratorka', admin: true },
  mobile: { name: 'Mobilna Marta' },
  a11y: { name: 'Klawiaturowy Kuba' },
  chaos: { name: 'Szybki Szymon' },
  attacker: { name: 'Mallory' },
  banned: { name: 'Zbanowany Zbyszek', banned: true },
} as const satisfies Record<
  string,
  { name: string; admin?: boolean; banned?: boolean }
>;
export type QaPersona = keyof typeof QA_PERSONAS;

/** `TEST_DATABASE_URL` with the database renamed to `studies_qa_test`. */
export function qaDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const u = new URL(url);
  u.pathname = '/studies_qa_test';
  return u.toString();
}

const discordId = (p: string) => `qa-${p}`;

async function sandbox(): Promise<void> {
  const url = qaDatabaseUrl();
  process.env.TEST_DATABASE_URL = url;
  rmSync(QA_STORAGE_DIR, { recursive: true, force: true });
  mkdirSync(QA_STORAGE_DIR, { recursive: true });
  await closeTestDb(await resetTestDb());

  const seeded = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/cli/seed.ts'],
    {
      cwd: join(repoRoot, 'packages/db'),
      stdio: ['ignore', 'ignore', 'inherit'],
      env: {
        ...process.env,
        DATABASE_URL: url,
        STORAGE_DIR: QA_STORAGE_DIR,
        WEB_BASE_URL: QA_BASE_URL,
      },
    },
  );
  if (seeded.status !== 0) throw new Error('seed failed');

  const { db, pool } = createDb(url);
  try {
    const ids: Partial<Record<QaPersona, number>> = {};
    for (const [key, p] of Object.entries(QA_PERSONAS)) {
      const id = await upsertUser(db, {
        discordUserId: discordId(key),
        displayName: p.name,
        avatarUrl: null,
      });
      await db
        .update(users)
        .set({
          isAdmin: 'admin' in p && p.admin,
          isBanned: 'banned' in p && p.banned,
        })
        .where(eq(users.id, id));
      ids[key as QaPersona] = id;
    }

    const [first] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .orderBy(asc(subjects.code))
      .limit(1);
    const author = ids.admin as number;
    const d = (days: number) => {
      const t = new Date(Date.now() + days * 86_400_000);
      return `${String(t.getUTCDate()).padStart(2, '0')}.${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    await addEvent(
      db,
      author,
      {
        kind: 'kolokwium',
        title: 'Kolokwium 1',
        subjectId: first?.id ?? null,
        when: `${d(3)} 10:00-11:30`,
        place: 'C-12',
        note: 'Zakres: wykłady 1–5.',
      },
      'web',
    );
    await addEvent(
      db,
      author,
      {
        kind: 'wyjazd',
        title: 'Wyjazd integracyjny',
        subjectId: null,
        when: d(10),
        place: 'Zakopane',
      },
      'web',
    );
    await addSeries(
      db,
      author,
      {
        kind: 'zajecia_dodatkowe',
        title: 'Konsultacje',
        subjectId: first?.id ?? null,
        when: `${d(1)} 16:00-17:00`,
        rule: 'weekly',
        until: d(29),
      },
      'web',
    );

    console.log(
      `QA sandbox ready: database studies_qa_test, files ${QA_STORAGE_DIR}`,
    );
    console.log(`Start the web server: pnpm qa:serve  (${QA_BASE_URL})`);
    console.log('Personas (pnpm qa:login <persona>):');
    for (const [key, p] of Object.entries(QA_PERSONAS)) {
      const flags = ['admin' in p && 'admin', 'banned' in p && 'banned']
        .filter(Boolean)
        .join(', ');
      console.log(`  ${key.padEnd(9)} ${p.name}${flags ? ` (${flags})` : ''}`);
    }
  } finally {
    await pool.end();
  }
}

async function login(persona: string | undefined): Promise<void> {
  if (!persona || !(persona in QA_PERSONAS)) {
    console.error(
      `Usage: pnpm qa:login <${Object.keys(QA_PERSONAS).join('|')}>`,
    );
    process.exit(1);
  }
  const { db, pool } = createDb(qaDatabaseUrl());
  try {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.discordUserId, discordId(persona)));
    if (!u) {
      console.error('Persona not found; run `pnpm qa:sandbox` first.');
      process.exit(1);
    }
    const token = await createLoginToken(db, u.id);
    console.log(`${QA_BASE_URL}/auth/callback?token=${token}`);
  } finally {
    await pool.end();
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'sandbox') await sandbox();
else if (cmd === 'login') await login(arg);
else {
  console.error('Usage: qa.ts sandbox | login <persona>');
  process.exit(1);
}

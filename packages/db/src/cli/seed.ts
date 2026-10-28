// Seeds the dev database with example data for every feature (subjects,
// classes/groups, lecturers, topics, tags, materials with real files,
// timetable sessions and exams, events and series, entry quizzes, My groups,
// reminder prefs, audit rows and one web upload) and prints one-time login
// links for a student (seed-u1) and the admin (seed-admin). The events are
// queued for the bot, which posts them to Discord.
//
// Refuses to run on a non-empty database unless `--reset` is given. `--reset`
// empties every table of this database except the migrations journal,
// `bot_settings` (admin role, panels, #wydarzenia, digest dates) and the
// `users` rows of real Discord accounts (numeric ids, with their ids and
// admin/ban flags). Each subject gets its Discord forum id back by code, and
// only the tags that forum really has (real tag ids; the bot's tag sync
// would delete the others). Before emptying, the links are printed and saved
// to STORAGE_DIR/seed-reset-links.json; a run interrupted after that point
// leaves an empty-looking database, and the next `pnpm db:seed` (no --reset
// needed) restores the links from the file. The file is removed on success.
//
// The first bot start after a reset rescans the linked forums from scratch
// (bot_state is emptied): their real threads, old event posts included,
// become topics next to the seeded ones.
// See seed-core.ts.
import { createLoginToken } from '../auth.js';
import { createDb } from '../client.js';
import { resolveStorageDir } from '../files.js';
import { SeedRefusedError, seedDatabase } from './seed-core.js';

const databaseUrl = process.env.DATABASE_URL;
const storageDirEnv = process.env.STORAGE_DIR;
if (!databaseUrl || !storageDirEnv) {
  console.error('DATABASE_URL and STORAGE_DIR must be set');
  process.exit(1);
}
const reset = process.argv.includes('--reset');
const storageDir = resolveStorageDir(storageDirEnv);
const webBaseUrl = process.env.WEB_BASE_URL || 'http://localhost:3000';

const { db, pool } = createDb(databaseUrl);
try {
  const s = await seedDatabase(db, { storageDir, reset });
  console.log(
    `seeded ${s.subjects} subjects, ${s.lecturers} lecturers, ${s.users} users, ${s.files} files, ${s.sessions} timetable sessions (${s.exams} exams)`,
  );
  console.log(
    `  ${s.events} events (${s.series} series), ${s.marks} entry quizzes, ${s.botRequests} bot requests queued`,
  );
  console.log(`files written to ${storageDir}`);
  if (s.kept.relinked.length) {
    console.log(
      `\nNote: the next bot start rescans the re-linked forums (${s.kept.relinked.join(', ')}) from scratch; their real threads, old event posts included, become topics next to the seeded ones.`,
    );
  }
  for (const [label, id] of [
    ['seed-u1 (student)', s.loginUsers.student],
    ['seed-admin (admin)', s.loginUsers.admin],
  ] as const) {
    const token = await createLoginToken(db, id);
    console.log(`\nLogin link for ${label} (valid 15 min, single use):`);
    console.log(`${webBaseUrl}/auth/callback?token=${token}`);
  }
} catch (err) {
  if (!(err instanceof SeedRefusedError)) throw err;
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

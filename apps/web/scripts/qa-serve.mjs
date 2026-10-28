// Web server for the QA sandbox (`pnpm qa:sandbox` first): `next dev` on :3200
// against `studies_qa_test` and `.qa/storage`, with its own build dir so it can
// run next to the dev server (:3000) and e2e (:3100).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const base = process.env.TEST_DATABASE_URL;
if (!base) {
  console.error('TEST_DATABASE_URL is not set');
  process.exit(1);
}
const withUser = (user, password) => {
  const u = new URL(base);
  u.pathname = '/studies_qa_test';
  if (user) {
    u.username = user;
    u.password = password;
  }
  return u.toString();
};
const port = 3200;
const storage = fileURLToPath(new URL('../../../.qa/storage', import.meta.url));

const child = spawn('npx', ['next', 'dev', '--webpack', '-p', String(port)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_DIST_DIR: '.next-qa',
    DATABASE_URL: withUser(),
    // The sandbox's own users (QA_RO_USER / QA_RW_USER in packages/db/src/cli/qa.ts).
    DATABASE_RO_URL: withUser('studies_ro_qa', 'qa-ro'),
    DATABASE_RW_URL: withUser('studies_rw_qa', 'qa-rw'),
    STORAGE_DIR: storage,
    WEB_BASE_URL: `http://localhost:${port}`,
    DISCORD_GUILD_ID: 'qaguild',
    // Keep more compiled pages in memory for longer (next.config.ts
    // onDemandEntries), so agents reloading many routes don't recompile.
    NEXT_DEV_PAGES_BUFFER: '30',
    NEXT_DEV_MAX_INACTIVE_MS: String(15 * 60_000),
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}

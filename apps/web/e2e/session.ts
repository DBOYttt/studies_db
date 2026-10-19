import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Cookie, expect, test } from '@playwright/test';

/** Session cookie files; wiped by globalSetup at the start of every run. */
export const E2E_SESSION_DIR = join(tmpdir(), 'studies-db-e2e-sessions');

/**
 * Logs in once per spec file and reuses the session cookies in every test.
 * Login tokens are single use and Playwright starts a fresh worker (re-running
 * `beforeAll`) after a failed test, so the cookies are persisted to a file on
 * the first login and later workers read them instead of re-spending the token.
 */
export function loginOnce(
  name: string,
  token: string | undefined,
  opts: { mode?: 'simple' | 'advanced' } = {},
) {
  const mode = opts.mode ?? 'advanced';
  const file = join(E2E_SESSION_DIR, `session-${name}.json`);
  let cookies: Cookie[] = [];
  test.beforeAll(async ({ browser }) => {
    if (existsSync(file)) {
      cookies = JSON.parse(readFileSync(file, 'utf8')) as Cookie[];
      return;
    }
    const context = await browser.newContext({ locale: 'pl-PL' });
    const page = await context.newPage();
    await page.goto(`http://localhost:3100/auth/callback?token=${token}`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/localhost:3100\/s$/);
    if (mode === 'advanced') {
      await context.addCookies([
        {
          name: 'studiesdb.mode',
          value: 'advanced',
          domain: 'localhost',
          path: '/',
        },
      ]);
    }
    cookies = await context.cookies();
    await context.close();
    writeFileSync(file, JSON.stringify(cookies));
  });
  test.beforeEach(async ({ context }) => {
    await context.addCookies(cookies);
  });
}

import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { loginOnce } from './session';

// Dead ends: unknown pages, races on a deleted event, an ended session and
// the mode switch after Back (QA 2026-10-30 U6, U7, chaos F1-F3, F5).
loginOnce('dead-ends', process.env.E2E_TOKEN_DEAD_ENDS, { mode: 'advanced' });

const DELETED = 'This event was deleted.';

function dateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function setMode(context: BrowserContext, mode: 'simple' | 'advanced') {
  await context.addCookies([
    { name: 'studiesdb.mode', value: mode, domain: 'localhost', path: '/' },
  ]);
}

/** Adds an event from the form of the given mode; returns its page path. */
async function addEvent(page: Page, base: '/s' | '', title: string) {
  await page.goto(`${base}/wydarzenia/nowe`);
  await page.getByLabel('Type').selectOption('kolokwium');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Date').fill(dateIn(9));
  await page.getByLabel('Starts').fill('10:00');
  await page.getByRole('button', { name: 'Add event' }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/wydarzenia/\\d+$`));
  return new URL(page.url()).pathname;
}

test('an unknown page is a branded 404 with a way back (advanced)', async ({
  page,
}) => {
  const res = await page.goto('/no-such-page');
  expect(res?.status()).toBe(404);
  await expect(page).toHaveTitle(/Page not found/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Page not found' }),
  ).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Start' })).toHaveAttribute(
    'href',
    '/',
  );
  await expect(main.getByRole('link', { name: 'Timetable' })).toHaveAttribute(
    'href',
    '/plan',
  );
});

test('an unknown page links to the simple view in simple mode', async ({
  page,
  context,
}) => {
  await setMode(context, 'simple');
  const res = await page.goto('/s/no-such-page');
  expect(res?.status()).toBe(404);
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Start' })).toHaveAttribute(
    'href',
    '/s',
  );
  await expect(main.getByRole('link', { name: 'Timetable' })).toHaveAttribute(
    'href',
    '/s/plan',
  );
});

test('a missing subject is the same branded 404', async ({ page }) => {
  const res = await page.goto('/subjects/NOPE404');
  expect(res?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Page not found' }),
  ).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Timetable' }),
  ).toHaveAttribute('href', '/plan');
  // Same text as an unknown address: a 404 never tells a hidden page apart.
  const text = await page.getByRole('main').innerText();
  await page.goto('/admin');
  expect(await page.getByRole('main').innerText()).toBe(text);
  await page.goto('/no-such-page');
  expect(await page.getByRole('main').innerText()).toBe(text);
});

test('a missing simple subject is a 404 that links to the simple view', async ({
  page,
  context,
}) => {
  await setMode(context, 'simple');
  const res = await page.goto('/s/subjects/NOPE404');
  expect(res?.status()).toBe(404);
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Timetable' }),
  ).toHaveAttribute('href', '/s/plan');
});

test('double-clicking "Yes, delete" ends on the timetable with a notice', async ({
  page,
  context,
}) => {
  await setMode(context, 'simple');
  await addEvent(page, '/s', 'Dwuklik usuwania');
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Yes, delete' }).dblclick();
  await expect(page).toHaveURL(/\/s\/plan$/);
  await expect(
    page.getByRole('status').filter({ hasText: DELETED }),
  ).toBeVisible();
  // The key is dropped from the URL, so a reload doesn't repeat it.
  await page.reload();
  await expect(page.getByText(DELETED)).toHaveCount(0);
});

test('a stale tab deleting a deleted event also ends on the timetable', async ({
  page,
  context,
}) => {
  await setMode(context, 'simple');
  const path = await addEvent(page, '/s', 'Stara karta');
  const other = await context.newPage();
  await other.goto(path);
  await other.getByRole('button', { name: 'Delete' }).click();
  await other.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(other).toHaveURL(/\/s\/plan$/);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(page).toHaveURL(/\/s\/plan$/);
  await expect(
    page.getByRole('status').filter({ hasText: DELETED }),
  ).toBeVisible();
});

test('an upload from a stale tab to a deleted event says so and stays', async ({
  page,
  context,
}) => {
  await setMode(context, 'simple');
  const path = await addEvent(page, '/s', 'Plik do usunietego');
  const other = await context.newPage();
  await other.goto(path);
  await other.getByRole('button', { name: 'Delete' }).click();
  await other.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(other).toHaveURL(/\/s\/plan$/);
  await other.close();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'notatki.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('notatki'),
  });
  await expect(
    page.getByRole('alert').filter({ hasText: DELETED }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(
    page.getByRole('heading', { name: 'Plik do usunietego' }),
  ).toBeVisible();
});

test('a form sent after the session ended explains why', async ({
  page,
  context,
}) => {
  await setMode(context, 'simple');
  await page.goto('/s/wydarzenia/nowe');
  await page.getByLabel('Title', { exact: true }).fill('Po wylogowaniu');
  // Signed out in another tab: the cookie is gone.
  await context.clearCookies({ name: 'sid' });
  await page.getByLabel('Type').selectOption('kolokwium');
  await page.getByLabel('Date').fill(dateIn(9));
  await page.getByLabel('Starts').fill('10:00');
  await page.getByRole('button', { name: 'Add event' }).click();
  await expect(page).toHaveURL(/\/login-info\?expired=1$/);
  await expect(
    page.getByText(
      'Your session has ended. Sign in again with /link in Discord.',
    ),
  ).toBeVisible();
});

test('an unknown session cookie leads to the session-ended message', async ({
  page,
  context,
}) => {
  await context.clearCookies({ name: 'sid' });
  await context.addCookies([
    { name: 'sid', value: 'not-a-session', domain: 'localhost', path: '/' },
  ]);
  await page.goto('/s/plan');
  await expect(page).toHaveURL(/\/login-info\?expired=1$/);
  await expect(page.getByText(/Your session has ended\./)).toBeVisible();
  // A first visit (no cookie at all) gets the plain sign-in text.
  await context.clearCookies();
  await page.goto('/login-info');
  await expect(page.getByText(/Your session has ended/)).toHaveCount(0);
  await expect(page.getByText(/To sign in, type \/link/)).toBeVisible();
});

test('the mode switch follows the URL after Back before hydration (chaos F3)', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const eventPath = await addEvent(page, '', 'Wstecz przed hydratacja');
  await page.goto('/plan');
  // Hold the JS back, so the event page's document is not hydrated yet when
  // the second Back (same document, a pushState entry) changes the URL.
  let release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/_next/static/**', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goBack({ waitUntil: 'commit' });
  await page
    .getByRole('heading', { name: 'Wstecz przed hydratacja' })
    .waitFor();
  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/wydarzenia\/nowe$/);
  release();
  await expect(page.getByRole('heading', { name: 'Add event' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'View mode' })
      .getByRole('link', { name: /Simple/ }),
  ).toHaveAttribute('href', '/mode?to=simple&next=%2Fwydarzenia%2Fnowe');
  expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
  expect(eventPath).toMatch(/^\/wydarzenia\/\d+$/);
});

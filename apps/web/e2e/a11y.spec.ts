import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

// Keyboard and screen-reader basics: page titles, the delete question,
// field errors. A student (not an admin) in the simple view.
loginOnce('a11y', process.env.E2E_TOKEN_A11Y, { mode: 'simple' });

const NOT_FOUND = 'Page not found · Studies DB';

function dateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test('every page has its own title; subjects are titled by name', async ({
  page,
}) => {
  const titles: string[] = [];
  for (const [url, title] of [
    ['/s', 'Start · Studies DB'],
    ['/s/plan', 'Timetable · Studies DB'],
    ['/s/subjects/FIZ', 'Fizyka techniczna · Studies DB'],
    ['/plan', 'Timetable · Studies DB'],
    [
      `/s/wydarzenia/${process.env.E2E_AUDIT_EVENT_ID}`,
      'Kolokwium audytu · Studies DB',
    ],
  ] as const) {
    await page.goto(url);
    await expect(page).toHaveTitle(title);
    titles.push(await page.title());
  }
  expect(new Set(titles.slice(0, 3)).size).toBe(3);
});

test('a hidden or missing page is titled like any 404', async ({ page }) => {
  for (const url of [
    `/s/wydarzenia/${process.env.E2E_HIDDEN_EVENT_ID}`,
    `/wydarzenia/${process.env.E2E_HIDDEN_EVENT_ID}`,
    '/admin',
    '/admin/subjects/FIZ',
    '/s/subjects/NOPE',
    '/no-such-page',
  ]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(404);
    await expect(page, url).toHaveTitle(NOT_FOUND);
    // The streamed title must never have named the entity either.
    expect(await page.content(), url).not.toContain('Ukryte wydarzenie');
  }
});

test('the delete question closes on Escape and Cancel, back on Delete', async ({
  page,
}) => {
  await page.goto(`/s/wydarzenia/${process.env.E2E_AUDIT_EVENT_ID}`);
  const del = page.getByRole('button', { name: 'Delete', exact: true });
  const question = page.getByRole('group', { name: 'Delete this event?' });

  await del.focus();
  await page.keyboard.press('Enter');
  await expect(question).toBeVisible();
  await expect(del).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(
    question.getByRole('button', { name: 'Yes, delete' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(question).toHaveCount(0);
  await expect(del).toBeFocused();
  await expect(del).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Enter');
  await question.getByRole('button', { name: 'Cancel' }).focus();
  await page.keyboard.press('Enter');
  await expect(question).toHaveCount(0);
  await expect(del).toBeFocused();
});

test('a refused title is marked invalid, described and focused', async ({
  page,
}) => {
  await page.goto('/s/wydarzenia/nowe');
  const title = page.getByLabel('Title', { exact: true });
  // Spaces pass the browser's `required` check; the server refuses them.
  await title.fill('  ');
  await page.getByLabel('Date').fill(dateIn(7));
  await page.getByLabel('Date').focus();
  await page.keyboard.press('Enter');

  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toHaveAccessibleDescription(
    'The title must be 1 to 100 characters.',
  );
  // The message is under the field, not a second general alert.
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Date')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
});

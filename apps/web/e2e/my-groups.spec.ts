import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

loginOnce('groups', process.env.E2E_TOKEN_GROUPS, { mode: 'simple' });

const GROUPS = '/s/plan?tab=groups';
const KEY = 'studiesdb.myGroups.v1';

test('a chosen group follows the user into a fresh browser context', async ({
  page,
  browser,
}) => {
  await page.goto(GROUPS);
  const select = page.getByLabel(/Plan testowy.*Ćwiczenia/);
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await select.selectOption({ label: 'Gr. 2' });
  await saved;
  await expect(
    page.getByRole('form', { name: 'My groups' }).getByRole('status'),
  ).toHaveText('Group saved.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/s\/plan$/);

  // New context = empty localStorage; only the session cookie is shared.
  const other = await browser.newContext({ locale: 'pl-PL' });
  try {
    await other.addCookies(await page.context().cookies());
    const page2 = await other.newPage();
    await page2.goto(`http://localhost:3100${GROUPS}`);
    await expect(
      page2.getByLabel(/Plan testowy.*Ćwiczenia/).locator('option:checked'),
    ).toHaveText('Gr. 2');
  } finally {
    await other.close();
  }
});

test('a choice left in localStorage is imported once and removed', async ({
  page,
}) => {
  await page.goto(GROUPS);
  const select = page.getByLabel(/Plan testowy.*Ćwiczenia/);
  const cleared = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Clear' }).click();
  await cleared;
  await expect(select.locator('option:checked')).toHaveText(
    'All groups (not picked)',
  );
  await expect(
    page.getByRole('form', { name: 'My groups' }).getByRole('status'),
  ).toHaveText('Groups cleared.');

  // Ids of the class and of "Gr. 2", as rendered.
  const classId = (await select.getAttribute('id'))?.replace('my-group-', '');
  const groupId = await select
    .locator('option', { hasText: 'Gr. 2' })
    .getAttribute('value');
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [KEY, JSON.stringify({ [classId as string]: Number(groupId) })],
  );

  await page.goto(GROUPS);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), KEY))
    .toBeNull();
  await expect(
    page.getByLabel(/Plan testowy.*Ćwiczenia/).locator('option:checked'),
  ).toHaveText('Gr. 2');
});

test('a stale localStorage key never resurrects cleared groups', async ({
  page,
}) => {
  await page.goto(GROUPS);
  const select = page.getByLabel(/Plan testowy.*Ćwiczenia/);
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await select.selectOption({ label: 'Gr. 2' });
  await saved;
  const classId = (await select.getAttribute('id'))?.replace('my-group-', '');
  const gr1 = await select
    .locator('option', { hasText: 'Gr. 1' })
    .getAttribute('value');
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [KEY, JSON.stringify({ [classId as string]: Number(gr1) })],
  );

  // The DB already has groups: the key is dropped, the DB choice stays.
  await page.goto(GROUPS);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), KEY))
    .toBeNull();
  await expect(
    page.getByLabel(/Plan testowy.*Ćwiczenia/).locator('option:checked'),
  ).toHaveText('Gr. 2');

  const cleared = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Clear' }).click();
  await cleared;
  await page.reload();
  await expect(
    page.getByLabel(/Plan testowy.*Ćwiczenia/).locator('option:checked'),
  ).toHaveText('All groups (not picked)');
  expect(
    await page.evaluate((key) => localStorage.getItem(key), KEY),
  ).toBeNull();
});

test('in simple mode every My groups link stays under /s', async ({ page }) => {
  const week = '/s/plan?week=2026-W42';
  await page.goto(week);
  await expect(page.getByText('Showing all groups.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pick yours' })).toHaveAttribute(
    'href',
    GROUPS,
  );
  await page.goto(GROUPS);
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await page
    .getByLabel(/Plan testowy.*Ćwiczenia/)
    .selectOption({ label: 'Gr. 2' });
  await saved;
  await page.goto(week);
  await expect(page.getByText('Filter: My groups')).toBeVisible();
  await expect(page.getByRole('link', { name: 'change' })).toHaveAttribute(
    'href',
    GROUPS,
  );
  const cleared = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.goto(GROUPS);
  await page.getByRole('button', { name: 'Clear' }).click();
  await cleared;
});

test('Reminders checkboxes persist', async ({ page }) => {
  await page.goto(GROUPS);
  const day = page.getByLabel('24 h before');
  const hour = page.getByLabel('1 h before');
  await expect(day).not.toBeChecked();
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await day.check();
  await saved;
  await expect(
    page.getByRole('region', { name: 'Reminders' }).getByRole('status'),
  ).toHaveText('Reminders saved.');
  await page.reload();
  await expect(page.getByLabel('24 h before')).toBeChecked();
  await expect(hour).not.toBeChecked();
  const undone = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByLabel('24 h before').uncheck();
  await undone;
});

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
  await page.getByRole('button', { name: 'Zapisz' }).click();
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
  await page.getByRole('button', { name: 'Wyczyść' }).click();
  await cleared;
  await expect(select.locator('option:checked')).toHaveText('Wszystkie');

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
  await page.getByRole('button', { name: 'Wyczyść' }).click();
  await cleared;
  await page.reload();
  await expect(
    page.getByLabel(/Plan testowy.*Ćwiczenia/).locator('option:checked'),
  ).toHaveText('Wszystkie');
  expect(
    await page.evaluate((key) => localStorage.getItem(key), KEY),
  ).toBeNull();
});

test('Przypomnienia checkboxes persist', async ({ page }) => {
  await page.goto(GROUPS);
  const day = page.getByLabel('24 h przed');
  const hour = page.getByLabel('1 h przed');
  await expect(day).not.toBeChecked();
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await day.check();
  await saved;
  await page.reload();
  await expect(page.getByLabel('24 h przed')).toBeChecked();
  await expect(hour).not.toBeChecked();
  const undone = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByLabel('24 h przed').uncheck();
  await undone;
});

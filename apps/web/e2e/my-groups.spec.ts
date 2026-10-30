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
  const groupStatus = page
    .getByRole('form', { name: 'My groups' })
    .getByRole('status');
  await expect(groupStatus).toHaveText('Group saved.');
  // Still there a while later (nothing re-renders it away).
  await page.waitForTimeout(4500);
  await expect(groupStatus).toHaveText('Group saved.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/s\/plan$/);
  // Save confirms itself on the week view it opens.
  await expect(
    page.getByRole('status').filter({ hasText: /^Groups saved\.$/ }),
  ).toBeVisible();

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
  const reminderStatus = page
    .getByRole('region', { name: 'Reminders' })
    .getByRole('status');
  await expect(reminderStatus).toHaveText('Reminders saved.');
  await expect(reminderStatus).toBeVisible();
  await page.waitForTimeout(4500);
  await expect(reminderStatus).toHaveText('Reminders saved.');
  await page.reload();
  await expect(page.getByLabel('24 h before')).toBeChecked();
  await expect(hour).not.toBeChecked();
  const undone = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByLabel('24 h before').uncheck();
  await undone;
});

// QA chaos F4: the Save of a tab opened earlier must not be silently lost.
test('the last Save wins when two tabs edit My groups', async ({
  page,
  context,
}) => {
  const tab2 = await context.newPage();
  await page.goto(GROUPS);
  await tab2.goto(GROUPS);
  const label = /Plan testowy.*Ćwiczenia/;

  // Tab 2 picks Gr. 2 but does not press Save yet.
  let posted = tab2.waitForResponse((r) => r.request().method() === 'POST');
  await tab2.getByLabel(label).selectOption({ label: 'Gr. 2' });
  await posted;

  // Tab 1 picks Gr. 1 and saves.
  posted = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByLabel(label).selectOption({ label: 'Gr. 1' });
  await posted;
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/s\/plan$/);

  // Tab 2 still shows Gr. 2 and saves it: that is the choice that stays.
  await tab2.getByRole('button', { name: 'Save' }).click();
  await expect(tab2).toHaveURL(/\/s\/plan$/);
  await tab2.goto(GROUPS);
  await expect(tab2.getByLabel(label).locator('option:checked')).toHaveText(
    'Gr. 2',
  );

  const cleared = tab2.waitForResponse((r) => r.request().method() === 'POST');
  await tab2.getByRole('button', { name: 'Clear' }).click();
  await cleared;
  await tab2.close();
});

// Review fix: Save writes only the classes this tab changed, so a stale tab
// never reverts groups picked elsewhere (another tab, the Discord panel).
test('a stale tab saves only what it changed', async ({ page, context }) => {
  const stale = await context.newPage();
  const editsA = await context.newPage();
  await stale.goto(GROUPS);
  await editsA.goto(GROUPS);
  await page.goto(GROUPS);
  const form = page.getByRole('form', { name: 'My groups' });
  const a = /Plan testowy.*Ćwiczenia/;
  // Class B: any other class with groups.
  const selects = form.locator('select');
  const aId = await form.getByLabel(a).getAttribute('id');
  let bId = '';
  for (const id of await selects.evaluateAll((els) => els.map((e) => e.id)))
    if (id !== aId) {
      bId = id;
      break;
    }
  expect(bId).not.toBe('');
  const b = (p: typeof page) => p.locator(`#${bId}`);
  const bOption = await b(page).locator('option').nth(1).textContent();

  // Elsewhere: A = Gr. 2 and a group in B.
  let posted = page.waitForResponse((r) => r.request().method() === 'POST');
  await form.getByLabel(a).selectOption({ label: 'Gr. 2' });
  await posted;
  posted = page.waitForResponse((r) => r.request().method() === 'POST');
  await b(page).selectOption({ index: 1 });
  await posted;

  // A stale tab with no edits: Save changes nothing.
  await stale.getByRole('button', { name: 'Save' }).click();
  await expect(stale).toHaveURL(/\/s\/plan$/);
  await expect(
    stale.getByRole('status').filter({ hasText: /^Groups saved\.$/ }),
  ).toBeVisible();
  await stale.goto(GROUPS);
  await expect(stale.getByLabel(a).locator('option:checked')).toHaveText(
    'Gr. 2',
  );
  await expect(b(stale).locator('option:checked')).toHaveText(
    bOption as string,
  );

  // A stale tab that edits A only: A changes, B stays.
  posted = editsA.waitForResponse((r) => r.request().method() === 'POST');
  await editsA.getByLabel(a).selectOption({ label: 'Gr. 1' });
  await posted;
  await editsA.getByRole('button', { name: 'Save' }).click();
  await expect(editsA).toHaveURL(/\/s\/plan$/);
  await editsA.goto(GROUPS);
  await expect(editsA.getByLabel(a).locator('option:checked')).toHaveText(
    'Gr. 1',
  );
  await expect(b(editsA).locator('option:checked')).toHaveText(
    bOption as string,
  );

  const cleared = editsA.waitForResponse(
    (r) => r.request().method() === 'POST',
  );
  await editsA.getByRole('button', { name: 'Clear' }).click();
  await cleared;
  await stale.close();
  await editsA.close();
});

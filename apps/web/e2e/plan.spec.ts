import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

loginOnce('plan', process.env.E2E_TOKEN_PLAN);

const WEEK = '/plan?week=2026-W42';

test('week view shows blocks with rooms and the session panel', async ({
  page,
}) => {
  await page.goto(WEEK);
  const blocks = page.getByTestId('plan-block');
  await expect(blocks).toHaveCount(4);
  await expect(blocks.filter({ hasText: 'A-1 101' })).toBeVisible();
  await expect(blocks.filter({ hasText: 'B-2 201' })).toBeVisible();

  const panel = page.getByRole('complementary', { name: 'Szczegóły zajęć' });
  await expect(async () => {
    await blocks.filter({ hasText: 'A-1 101' }).click();
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(panel.getByText('A-1 101')).toBeVisible();
  await expect(panel.getByText('Piotr Planista')).toBeVisible();
  const lecturer = panel.getByRole('link', { name: 'Prowadzący' });
  await expect(lecturer).toHaveAttribute('href', /^\/lecturers\/\d+$/);
});

test('Moje grupy filters groups, persists, and clears', async ({ page }) => {
  await page.goto('/plan?tab=groups');
  const select = page.getByLabel(/Plan testowy.*Ćwiczenia/);
  await select.selectOption({ label: 'Gr. 2' });
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await page.goto(WEEK);

  const blocks = page.getByTestId('plan-block');
  await expect(page.getByText('Filtr: Moje grupy')).toBeVisible();
  await expect(blocks.filter({ hasText: 'B-2 201' })).toHaveCount(0);
  await expect(blocks.filter({ hasText: 'B-2 202' })).toHaveCount(1);
  await expect(blocks.filter({ hasText: 'A-1 101' })).toHaveCount(1);
  const note = page.getByRole('link', {
    name: 'Ukryte zajęcia: 1 — uzupełnij Moje grupy',
  });
  await expect(note).toBeVisible();
  await expect(note).toHaveAttribute('href', '/plan?tab=groups');

  await page.reload();
  await expect(page.getByText('Filtr: Moje grupy')).toBeVisible();
  await expect(blocks.filter({ hasText: 'B-2 201' })).toHaveCount(0);

  await page.goto('/plan?tab=groups');
  // The choice lives in the DB: wait for the save to land before leaving.
  const cleared = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/plan'),
  );
  await page.getByRole('button', { name: 'Wyczyść' }).click();
  await cleared;
  await page.goto(WEEK);
  // A block click only works once hydrated, so the checks below see the
  // settled page, not the server HTML.
  const clearedPanel = page.getByRole('complementary', {
    name: 'Szczegóły zajęć',
  });
  await expect(async () => {
    await blocks.filter({ hasText: 'B-2 201' }).click();
    await expect(clearedPanel).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.getByText('Filtr: Moje grupy')).toHaveCount(0);
  await expect(page.getByText(/Ukryte zajęcia/)).toHaveCount(0);
  await expect(blocks).toHaveCount(4);
});

test('list tab is a v_class_sessions grid', async ({ page }) => {
  await page.goto('/plan?tab=list');
  const main = page.getByRole('main');
  await expect(main.getByText('v_class_sessions').first()).toBeVisible();
  await expect(main.getByRole('cell', { name: 'A-1 101' })).toBeVisible();
});

test('subject plan tab shows only that subject', async ({ page }) => {
  await page.goto('/subjects/PLAN?tab=plan&week=2026-W42');
  const blocks = page.getByTestId('plan-block');
  await expect(blocks).toHaveCount(3);
  await expect(blocks.filter({ hasText: 'D-4 404' })).toHaveCount(0);
});

test('lecturer plan tab shows their sessions', async ({ page }) => {
  await page.goto('/tables/v_lecturers');
  const href = await page
    .getByRole('main')
    .getByRole('link', { name: 'Piotr Planista', exact: true })
    .getAttribute('href');
  await page.goto(`${href}?tab=plan&week=2026-W42`);
  const blocks = page.getByTestId('plan-block');
  await expect(blocks).toHaveCount(1);
  await expect(blocks.first()).toContainText('A-1 101');
});

test('Prowadzący tab: office hours, room and platform links', async ({
  page,
}) => {
  await page.goto('/subjects/PLAN?tab=lecturers');
  const table = page.getByRole('table', { name: 'Prowadzący' });
  await expect(table.getByText('wt. 13:00-14:00')).toBeVisible();
  await expect(table.getByText('C-3 305')).toBeVisible();
  const classes = page.getByRole('table', { name: 'Zajęcia', exact: true });
  await expect(
    classes.getByRole('link', { name: 'Platforma ↗' }),
  ).toHaveAttribute('href', 'https://platforma.example.edu/cwiczenia');
  await expect(
    page.getByRole('link', { name: 'UPeL / platforma ↗' }),
  ).toHaveAttribute('href', 'https://upel.example.edu/course/plan');
});

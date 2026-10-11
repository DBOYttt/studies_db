import { type Cookie, expect, test } from '@playwright/test';

// Login tokens are single use: log in once, then reuse the session cookies.
let cookies: Cookie[] = [];
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ locale: 'pl-PL' });
  const page = await context.newPage();
  await page.goto(
    `http://localhost:3100/auth/callback?token=${process.env.E2E_TOKEN_EXPLORER}`,
  );
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page).toHaveURL(/\/$/);
  cookies = await context.cookies();
  await context.close();
});
test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});

const treeNav = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Drzewo przedmiotu' });

test('drill down class > group > file, map and schema follow the selection', async ({
  page,
}) => {
  await page.goto('/subjects/MECH');
  const tree = treeNav(page);
  await tree.getByRole('link', { name: /Laboratorium/ }).click();
  await expect(page).toHaveURL(/class=laboratorium/);
  await tree.getByRole('link', { name: /Gr\. 3/ }).click();
  await expect(page).toHaveURL(/class=laboratorium&group=3/);

  await page.getByRole('link', { name: 'lab-sprawozdanie.pdf' }).click();
  await expect(page).toHaveURL(/class=laboratorium&group=3.*file=\d+/);
  const panel = page.getByRole('complementary', { name: 'Podgląd pliku' });
  await expect(panel.locator('canvas').first()).toBeVisible({
    timeout: 30_000,
  });

  // Data map: the group node is highlighted; a topic node returns to the explorer.
  await page.getByRole('link', { name: 'Mapa danych' }).click();
  await expect(page).toHaveURL(/tab=map/);
  await expect(page.getByRole('button', { name: /^Gr\. 3/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await page.getByRole('button', { name: /Sprawozdanie z ćwiczenia/ }).click();
  await expect(page).not.toHaveURL(/tab=map/);
  await expect(page).toHaveURL(/topic=\d+/);
  await expect(
    treeNav(page).getByRole('link', { name: /Sprawozdanie z ćwiczenia/ }),
  ).toHaveAttribute('aria-current', 'page');

  // Schema: the caption names the deepest selected level.
  await page.goto('/subjects/MECH?class=laboratorium&group=3&tab=schema');
  await expect(page.getByText('Gr. 3 jest w v_class_groups')).toBeVisible();
});

test('stale URL params render the tree without error', async ({ page }) => {
  const res = await page.goto('/subjects/MECH?class=foo&group=abc&file=999999');
  expect(res?.status()).toBe(200);
  await expect(treeNav(page)).toBeVisible();
  // An unknown file id shows the "deleted" state, never a real preview.
  const panel = page.getByRole('complementary', { name: 'Podgląd pliku' });
  await expect(
    panel.getByRole('heading', { name: 'Plik został usunięty' }),
  ).toBeVisible();
  await expect(panel.locator('canvas')).toHaveCount(0);
});

test('mobile: select navigation and full-screen preview sheet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/subjects/MECH?class=laboratorium&group=3');
  await expect(treeNav(page)).toBeHidden();
  await expect(
    page.getByRole('combobox', { name: 'Lokalizacja' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'lab-sprawozdanie.pdf' }).click();
  const panel = page.getByRole('complementary', { name: 'Podgląd pliku' });
  await expect(panel).toBeVisible();
  await expect
    .poll(async () => panel.boundingBox())
    .toMatchObject({ x: 0, y: 0, width: 375, height: 800 });
  await panel.getByRole('link', { name: 'Zamknij podgląd' }).click();
  await expect(panel).toHaveCount(0);
});

test('table browser preview is a full-screen sheet on mobile', async ({
  page,
}) => {
  await page.goto('/tables/v_files?sort=filename&dir=asc&f_filename=lab-');
  await page
    .getByRole('link', { name: 'lab-sprawozdanie.pdf' })
    .first()
    .click();
  const panel = page.getByRole('complementary', { name: 'Podgląd pliku' });
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  await expect
    .poll(async () => panel.boundingBox())
    .toMatchObject({ x: 0, y: 0, width: 375, height: 800 });
  await panel.getByRole('link', { name: 'Zamknij podgląd' }).click();
  await expect(panel).toHaveCount(0);
});

test('sql console prefills from ?q= without running', async ({ page }) => {
  await page.goto('/sql?q=SELECT%201');
  await expect(page.locator('.cm-content')).toContainText('SELECT 1');
  await expect(page.getByRole('cell', { name: '1', exact: true })).toHaveCount(
    0,
  );
});

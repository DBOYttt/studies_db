import { type Cookie, expect, type Page, test } from '@playwright/test';

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

const treeNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Drzewo bazy danych' });

test('drill down class > group > file, map and schema follow the selection', async ({
  page,
}) => {
  await page.goto('/subjects/MECH');
  // The subject description renders as plain text (no HTML injection).
  await expect(page.getByText('Statyka i dynamika <b>brył</b>')).toBeVisible();
  const tree = treeNav(page);
  // The active subject is highlighted and open, showing its classes.
  await expect(tree.getByRole('link', { name: /Mechanika/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await tree.getByRole('link', { name: /Laboratorium/ }).click();
  await expect(page).toHaveURL(/class=laboratorium$/);
  await tree.getByRole('link', { name: /Gr\. 3/ }).click();
  await expect(page).toHaveURL(/class=laboratorium&group=3$/);
  await expect(tree.getByRole('link', { name: /Gr\. 3/ })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const main = page.getByRole('main');
  await main.getByRole('link', { name: 'lab-sprawozdanie.pdf' }).click();
  await expect(page).toHaveURL(/class=laboratorium&group=3.*file=\d+/);
  const panel = page.getByRole('complementary', { name: 'Podgląd pliku' });
  await expect(panel.locator('canvas').first()).toBeVisible({
    timeout: 30_000,
  });

  // Escape while typing in the grid filter must not close the preview.
  const search = main.getByRole('searchbox', { name: /Filtruj wiersze/ });
  await search.fill('lab');
  await search.press('Escape');
  // router.push is async: give a wrongly-handled Escape time to navigate.
  await page.waitForTimeout(750);
  await expect(page).toHaveURL(/file=\d+/);
  await expect(panel).toBeVisible();

  // Data map: the group node is highlighted; a topic node returns to the explorer.
  const tabs = page.getByRole('navigation', { name: 'Zakładki' });
  await tabs.getByRole('link', { name: 'Mapa danych' }).click();
  await expect(page).toHaveURL(/tab=map/);
  await expect(page.getByRole('button', { name: /^Gr\. 3/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await page.getByRole('button', { name: /Sprawozdanie z ćwiczenia/ }).click();
  await expect(page).not.toHaveURL(/tab=map/);
  await expect(page).toHaveURL(/topic=\d+/);
  await expect(
    page
      .getByRole('navigation', { name: 'Ścieżka' })
      .getByRole('link', { name: 'Sprawozdanie z ćwiczenia' }),
  ).toHaveAttribute('aria-current', 'page');

  // Schemat: the caption names the deepest selected level.
  await page.goto('/subjects/MECH?class=laboratorium&group=3&tab=schema');
  await expect(
    page.getByText(/^Gr\. 3 jest w v_class_groups \(id \d+\)$/),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /^Tabela v_class_groups,/ }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(
    page.getByRole('link', { name: /^Tabela v_files,/ }),
  ).not.toHaveAttribute('aria-current', 'true');
});

test('stale URL params render the tree without error', async ({ page }) => {
  const res = await page.goto('/subjects/MECH?class=foo&group=abc&file=999999');
  expect(res?.status()).toBe(200);
  await expect(treeNav(page)).toBeVisible();
  // An unknown file id shows the "deleted" state, never a real preview.
  const panel = page.getByRole('complementary', { name: 'Podgląd pliku' });
  await expect(panel.getByText('Plik został usunięty')).toBeVisible();
  await expect(panel.locator('canvas')).toHaveCount(0);
});

test('mobile: drawer navigation and full-screen preview sheet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/subjects/MECH');
  const tree = treeNav(page);
  await expect(tree).toBeHidden();
  const menu = page.getByRole('button', { name: 'Otwórz panel nawigacji' });
  const drawer = page.getByRole('dialog', { name: 'Panel nawigacji' });

  await menu.click();
  await expect(drawer).toBeVisible();
  await tree.getByRole('link', { name: /Laboratorium/ }).click();
  // Following a link closes the drawer.
  await expect(page).toHaveURL(/class=laboratorium$/);
  await expect(drawer).toHaveCount(0);
  await expect(tree).toBeHidden();

  // The class stays open in the tree: the group is one tap away.
  await menu.click();
  await tree.getByRole('link', { name: /Gr\. 3/ }).click();
  await expect(page).toHaveURL(/class=laboratorium&group=3$/);
  await expect(tree).toBeHidden();

  await page
    .getByRole('main')
    .getByRole('link', { name: 'lab-sprawozdanie.pdf' })
    .click();
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
    .getByRole('main')
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
  await expect(page.getByRole('button', { name: 'Wykonaj' })).toBeEnabled();
  await expect(page.getByRole('cell', { name: '1', exact: true })).toHaveCount(
    0,
  );
});

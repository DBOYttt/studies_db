import { type Cookie, expect, type Page, test } from '@playwright/test';

// Login tokens are single use: log in once, then reuse the session cookies.
let cookies: Cookie[] = [];
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ locale: 'pl-PL' });
  const page = await context.newPage();
  await page.goto(
    `http://localhost:3100/auth/callback?token=${process.env.E2E_TOKEN_ENTITIES}`,
  );
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page).toHaveURL(/\/$/);
  cookies = await context.cookies();
  await context.close();
});
test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});

const tabsNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Zakładki' });

/** Lecturer page href, read from the v_lecturers grid (ids are not fixed). */
async function lecturerPath(page: Page, name: string): Promise<string> {
  await page.goto('/tables/v_lecturers');
  const href = await page
    .getByRole('main')
    .getByRole('link', { name, exact: true })
    .getAttribute('href');
  expect(href).toMatch(/^\/lecturers\/\d+$/);
  return href as string;
}

test('lecturer page: assignments, materials of own groups, links', async ({
  page,
}) => {
  const nowak = await lecturerPath(page, 'Anna Nowak');
  await page.goto('/tables/v_class_lecturers');
  const main = page.getByRole('main');
  await main.locator(`a[href="${nowak}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`${nowak}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Anna Nowak',
  );

  const table = main.getByRole('table', { name: 'Zajęcia prowadzącego' });
  await expect(table.getByRole('link', { name: 'Gr. 3' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Gr. 2' })).toHaveCount(0);

  await tabsNav(page).getByRole('link', { name: 'Materiały' }).click();
  await expect(page).toHaveURL(/tab=files/);
  await expect(
    main.getByRole('link', { name: 'lab-sprawozdanie.pdf' }),
  ).toBeVisible();
  await expect(main.getByRole('link', { name: 'lab-gr2.pdf' })).toHaveCount(0);

  // Podgląd opens the preview panel next to the grid.
  await main.getByRole('link', { name: 'lab-sprawozdanie.pdf' }).click();
  await expect(page).toHaveURL(/preview=\d+/);
  await expect(
    page.getByRole('complementary', { name: 'Podgląd pliku' }),
  ).toBeVisible();

  await tabsNav(page).getByRole('link', { name: 'Zajęcia' }).click();
  await table.getByRole('link', { name: 'Gr. 3' }).click();
  await expect(page).toHaveURL(/\/subjects\/MECH\?class=laboratorium&group=3$/);
});

test('whole-class lecturer shows "Wszystkie grupy"', async ({ page }) => {
  await page.goto(await lecturerPath(page, 'Jan Kowalski'));
  const table = page.getByRole('table', { name: 'Zajęcia prowadzącego' });
  await expect(
    table.getByRole('link', { name: 'Wszystkie grupy' }),
  ).toBeVisible();
  await expect(table.getByRole('link', { name: 'Wykład' })).toBeVisible();
});

test('user page: uploaded files and topics', async ({ page }) => {
  await page.goto('/tables/v_users');
  const main = page.getByRole('main');
  await main.getByRole('link', { name: 'Ewa Testowa', exact: true }).click();
  await expect(page).toHaveURL(/\/users\/\d+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Ewa Testowa',
  );
  for (const f of ['sample.pdf', 'lab-sprawozdanie.pdf', 'lab-gr2.pdf']) {
    await expect(main.getByRole('link', { name: f })).toBeVisible();
  }
  await tabsNav(page).getByRole('link', { name: 'Tematy' }).click();
  await expect(page).toHaveURL(/tab=topics/);
  await expect(
    main.getByRole('link', { name: 'Sprawozdanie z ćwiczenia' }),
  ).toBeVisible();
});

test('tag page: tagged topics and their files', async ({ page }) => {
  await page.goto('/tables/v_tags');
  const main = page.getByRole('main');
  await main.getByRole('link', { name: 'Kolokwium', exact: true }).click();
  await expect(page).toHaveURL(/\/tags\/\d+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Kolokwium',
  );
  await expect(
    main.getByRole('link', { name: 'Kolokwium 1 — tarcie' }),
  ).toBeVisible();
  await expect(
    main.getByRole('link', { name: 'Sprawozdanie z ćwiczenia' }),
  ).toHaveCount(0);
  await tabsNav(page).getByRole('link', { name: 'Pliki' }).click();
  await expect(page).toHaveURL(/tab=files/);
  await expect(main.getByRole('link', { name: 'sample.pdf' })).toBeVisible();
  await expect(
    main.getByRole('link', { name: 'lab-sprawozdanie.pdf' }),
  ).toHaveCount(0);
});

test('bad or unknown ids are 404', async ({ page }) => {
  for (const path of [
    '/lecturers/abc',
    '/lecturers/999999',
    '/users/0',
    '/tags/999999',
  ]) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByText(/404|nie znaleziono/i).first()).toBeVisible();
  }
});

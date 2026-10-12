import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

// No advanced cookie: this spec exercises the default (Prosty) view.
loginOnce('simple', process.env.E2E_TOKEN_SIMPLE, { mode: 'simple' });

test('fresh login without a mode cookie lands on /s', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'pl-PL' });
  const page = await context.newPage();
  await page.goto(
    `http://localhost:3100/auth/callback?token=${process.env.E2E_TOKEN_SIMPLE_LANDING}`,
  );
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page).toHaveURL(/localhost:3100\/s$/);
  await context.close();
});

test('login lands on Start with subject cards and Ostatnio dodane', async ({
  page,
}) => {
  await page.goto('/s');
  await expect(
    page.getByRole('heading', { name: 'Przedmioty' }).first(),
  ).toBeVisible();
  const main = page.getByRole('main');
  for (const code of ['FIZ', 'MECH', 'PLAN']) {
    await expect(
      main.getByRole('link', { name: new RegExp(`^${code}\\b`) }),
    ).toBeVisible();
  }
  await expect(
    main.getByRole('heading', { name: 'Ostatnio dodane' }),
  ).toBeVisible();
  await expect(
    main.getByRole('link', { name: 'wyklad-slajdy.pdf', exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole('link', { name: /^PLAN\b/ }).getByText('brak plików'),
  ).toBeVisible();
});

test('/ redirects to /s in simple mode', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/s$/);
});

test('subject filters, preview panel and download', async ({ page }) => {
  await page.goto('/s');
  await page
    .getByRole('main')
    .getByRole('link', { name: /^MECH\b/ })
    .click();
  await expect(page).toHaveURL(/\/s\/subjects\/MECH/);
  const main = page.getByRole('main');
  await expect(
    main.getByRole('link', { name: 'lab-gr2.pdf', exact: true }),
  ).toBeVisible();

  await main.getByRole('link', { name: 'Laboratorium', exact: true }).click();
  await expect(page).toHaveURL(/class=laboratorium/);
  await expect(
    main.getByRole('link', { name: 'wyklad-slajdy.pdf', exact: true }),
  ).toHaveCount(0);
  await expect(
    main.getByRole('link', { name: 'Laboratorium', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(
    main.getByRole('link', { name: 'lab-gr2.pdf', exact: true }),
  ).toBeVisible();

  await main.getByRole('link', { name: 'Gr. 3', exact: true }).click();
  await expect(page).toHaveURL(/group=3/);
  await expect(
    main.getByRole('link', { name: 'lab-gr2.pdf', exact: true }),
  ).toHaveCount(0);
  const file = main.getByRole('link', {
    name: 'lab-sprawozdanie.pdf',
    exact: true,
  });
  await expect(file.first()).toBeVisible();

  const panel = page.getByRole('complementary', { name: 'Podgląd pliku' });
  await main
    .getByRole('link', { name: 'Podgląd pliku lab-sprawozdanie.pdf' })
    .click();
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/file=\d+/);
  await expect(panel.getByRole('link', { name: 'Pobierz' })).toHaveAttribute(
    'href',
    /^\/files\/\d+\/original$/,
  );

  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await expect(page).not.toHaveURL(/file=/);
  await expect(page).toHaveURL(/group=3/);
});

test('empty subject shows the empty state', async ({ page }) => {
  await page.goto('/s/subjects/PLAN');
  await expect(
    page.getByText('Brak plików dla wybranych filtrów.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pliki (0)' })).toBeVisible();
});

test('search highlights hits with <mark>', async ({ page }) => {
  await page.goto('/s/search?q=lab');
  const marks = page.getByRole('main').locator('mark');
  await expect(marks.first()).toBeVisible();
  await expect(marks.first()).toHaveText(/lab/i);
});

test('reports: card shows table with Autor header and CSV link', async ({
  page,
}) => {
  await page.goto('/s/reports');
  await page.getByRole('link', { name: /Najaktywniejsi uploaderzy/ }).click();
  await expect(page).toHaveURL(/r=1/);
  await expect(page.getByRole('columnheader', { name: 'Autor' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pobierz CSV' })).toHaveAttribute(
    'href',
    '/s/reports/csv?r=1',
  );
});

test('Plan zajęć from the sidebar shows week blocks', async ({ page }) => {
  await page.goto('/s');
  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('link', { name: 'Plan zajęć' })
    .click();
  await expect(page).toHaveURL(/\/s\/plan/);
  await page.goto('/s/plan?week=2026-W42');
  await expect(page.getByTestId('plan-block')).toHaveCount(4);
});

test('mode switch round trip keeps the chosen mode', async ({ page }) => {
  await page.goto('/s/subjects/MECH');
  const switcher = page.getByRole('navigation', { name: 'Tryb widoku' });
  await switcher.getByRole('link', { name: 'Zaawansowany' }).click();
  await expect(page).toHaveURL(/\/subjects\/MECH/);
  await expect(page).not.toHaveURL(/\/s\//);

  await page.reload();
  await expect(page).toHaveURL(/\/subjects\/MECH/);
  await page.goto('/');
  await expect(page).toHaveURL(/localhost:3100\/$/);

  await page.goto('/subjects/MECH');
  await page
    .getByRole('navigation', { name: 'Tryb widoku' })
    .getByRole('link', { name: 'Prosty' })
    .click();
  await expect(page).toHaveURL(/\/s\/subjects\/MECH/);
});

test('/mode rejects a protocol-relative next', async ({ page }) => {
  await page.goto('/mode?to=simple&next=//evil.com');
  await expect(page).toHaveURL(/localhost:3100\/s$/);
});

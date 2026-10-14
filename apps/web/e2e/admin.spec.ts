import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

// One login per role; sessions are persisted per name by loginOnce.
loginOnce('admin', process.env.E2E_TOKEN_ADMIN);

test('admin sees the Admin entry and is listed on Przegląd', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
  await page.goto('/admin');
  await expect(
    page.getByRole('heading', { name: 'Panel admina' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Admini' })
      .getByText('Adam Administrator'),
  ).toBeVisible();
});

test('SQL write console: preview, execute, audit log', async ({ page }) => {
  const statement = "UPDATE subjects SET ects = 7 WHERE code = 'MECH'";
  await page.goto('/admin/sql');
  const editor = page.getByRole('textbox', { name: 'Instrukcja SQL (zapis)' });
  await editor.click();
  await page.keyboard.type(statement);
  await page.getByRole('button', { name: 'Podgląd', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Podgląd zmiany' });
  await expect(preview.getByText(/zostan(ie|ą) zmienion/)).toContainText(
    /(^|\D)1 wiersz\b/,
  );
  await page.getByRole('button', { name: 'Wykonaj', exact: true }).click();
  await expect(page.getByText(/Zapisano:/)).toBeVisible();

  await page.goto('/admin/audit');
  await expect(page.getByText(statement).first()).toBeVisible();
});

test('simple sidebar shows Panel admina for the admin', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'pl-PL' });
  try {
    const page = await context.newPage();
    await page.goto(
      `http://localhost:3100/auth/callback?token=${process.env.E2E_TOKEN_ADMIN_SIMPLE}`,
    );
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await expect(page).toHaveURL(/localhost:3100\/s$/);
    await expect(
      page.getByRole('link', { name: 'Panel admina' }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test.describe('non-admin', () => {
  loginOnce('nonadmin', process.env.E2E_TOKEN_NONADMIN, { mode: 'simple' });

  test('gets 404 on /admin and /admin/sql, and no sidebar entry', async ({
    page,
  }) => {
    for (const path of ['/admin', '/admin/sql']) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(404);
    }
    await page.goto('/s');
    await expect(page.getByRole('link', { name: 'Panel admina' })).toHaveCount(
      0,
    );
  });

  test('POST /api/admin/sql returns 404', async ({ context }) => {
    const res = await context.request.post('/api/admin/sql', {
      headers: { Origin: 'http://localhost:3100' },
      data: { action: 'preview', sql: 'SELECT 1' },
    });
    expect(res.status()).toBe(404);
  });
});

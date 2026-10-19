import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

// One login per role; sessions are persisted per name by loginOnce.
loginOnce('admin', process.env.E2E_TOKEN_ADMIN);

test('admin sees the Admin entry and is listed on Overview', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
  await page.goto('/admin');
  await expect(
    page.getByRole('heading', { name: 'Admin panel' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Admins' })
      .getByText('Adam Administrator'),
  ).toBeVisible();
});

test('SQL write console: preview, execute, audit log', async ({ page }) => {
  const statement = "UPDATE subjects SET ects = 7 WHERE code = 'MECH'";
  await page.goto('/admin/sql');
  const editor = page.getByRole('textbox', { name: 'SQL statement (write)' });
  await editor.click();
  await page.keyboard.type(statement);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Change preview' });
  await expect(preview.getByText(/will be changed/)).toContainText(
    /(^|\D)1 row\b/,
  );
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByText(/Saved:/)).toBeVisible();

  await page.goto('/admin/audit');
  await expect(page.getByText(statement).first()).toBeVisible();
});

test('simple sidebar shows Admin panel for the admin', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'pl-PL' });
  try {
    const page = await context.newPage();
    await page.goto(
      `http://localhost:3100/auth/callback?token=${process.env.E2E_TOKEN_ADMIN_SIMPLE}`,
    );
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/localhost:3100\/s$/);
    await expect(page.getByRole('link', { name: 'Admin panel' })).toBeVisible();
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
    await expect(page.getByRole('link', { name: 'Admin panel' })).toHaveCount(
      0,
    );
  });

  test('pages ship no admin entries, not even in their scripts', async ({
    page,
    context,
  }) => {
    const scripts: Promise<string>[] = [];
    page.on('response', (r) => {
      if (r.request().resourceType() === 'script') {
        scripts.push(r.text().catch(() => ''));
      }
    });
    for (const [mode, path] of [
      ['simple', '/s'],
      ['advanced', '/'],
    ] as const) {
      await context.addCookies([
        { name: 'studiesdb.mode', value: mode, url: 'http://localhost:3100' },
      ]);
      await page.goto(path);
      await page.waitForLoadState('load');
      await expect(
        page.getByRole('link', { name: 'Admin', exact: true }),
      ).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Admin panel' })).toHaveCount(
        0,
      );
    }
    const js = (await Promise.all(scripts)).join('\n');
    expect(js).not.toContain('Admin panel');
    expect(js).not.toMatch(/title:\s*"Admin"/);
  });

  test('POST /api/admin/sql returns 404', async ({ context }) => {
    const res = await context.request.post('/api/admin/sql', {
      headers: { Origin: 'http://localhost:3100' },
      data: { action: 'preview', sql: 'SELECT 1' },
    });
    expect(res.status()).toBe(404);
  });
});

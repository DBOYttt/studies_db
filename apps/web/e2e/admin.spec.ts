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
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText(/Saved:/)).toBeVisible();

  await page.goto('/admin/audit');
  await expect(page.getByText(statement).first()).toBeVisible();
});

test('SQL write console: a cascading DELETE needs the typed table name', async ({
  page,
}) => {
  await page.goto('/admin/sql');
  const editor = page.getByRole('textbox', { name: 'SQL statement (write)' });
  const previewBtn = page.getByRole('button', { name: 'Preview', exact: true });
  const preview = page.getByRole('region', { name: 'Change preview' });
  const run = page.getByRole('button', { name: 'Run', exact: true });
  const note = preview.getByText(
    'Rows in other tables that reference these rows are deleted too.',
  );
  // Only previewed (rolled back), never run: it would delete a seeded tag.
  await editor.click();
  await page.keyboard.type("DELETE FROM tags WHERE name = 'Kolokwium'");
  await previewBtn.click();
  await expect(note).toBeVisible();
  await expect(run).toBeDisabled();
  await preview.getByRole('textbox', { name: /To confirm/ }).fill('tags');
  await expect(run).toBeEnabled();
  // Matching no rows, it deletes nothing anywhere: no confirmation.
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type("DELETE FROM subjects WHERE code = 'NO-SUCH'");
  await previewBtn.click();
  await expect(preview.getByText(/will be changed/)).toContainText('0 rows');
  await expect(note).toHaveCount(0);
  await expect(
    preview.getByRole('textbox', { name: /To confirm/ }),
  ).toHaveCount(0);
  await expect(run).toBeEnabled();
});

test('audit log reads as a log: user, plain action, named target, details', async ({
  page,
}) => {
  await page.goto('/admin/audit');
  const table = page.getByRole('table');
  for (const h of ['Time', 'User', 'Action', 'Target', 'Details'])
    await expect(table.getByRole('columnheader', { name: h })).toBeVisible();
  // One filter for who: the User select (no separate Everyone/Admins toggle).
  await expect(
    page.getByRole('navigation', { name: 'Audit log scope' }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel('User').locator('option', { hasText: 'Admins only' }),
  ).toHaveCount(1);
  const row = table
    .getByRole('row')
    .filter({ hasText: 'Kolokwium audytu' })
    .first();
  await expect(row).toContainText('Ewa Testowa');
  await expect(row).toContainText('Event added');
  await expect(row).toContainText('via the website');
  await expect(row).toContainText(/\d{2}:\d{2}:\d{2} CES?T/);
  await expect(
    row.getByRole('link', { name: 'Test: Kolokwium audytu FIZ, 26 Jan' }),
  ).toHaveAttribute('href', `/wydarzenia/${process.env.E2E_AUDIT_EVENT_ID}`);
});

test('at 375 px the audit Action column is on screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/admin/audit');
  const action = page
    .getByRole('row')
    .filter({ hasText: 'Kolokwium audytu' })
    .first()
    .getByText('Event added');
  const box = await action.boundingBox();
  expect((box?.x ?? 999) + (box?.width ?? 0)).toBeLessThanOrEqual(375);
});

test('admin SQL editor keeps its height from the first paint (no shift)', async ({
  page,
  browser,
}) => {
  await page.goto('/admin/sql');
  const editor = page.getByTestId('admin-sql-editor');
  await expect(editor.locator('.cm-editor')).toBeVisible();
  const hydrated = (await editor.boundingBox())?.height ?? 0;
  // Server HTML only: what the page looks like before CodeMirror mounts.
  const cookies = await page.context().cookies();
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  try {
    await ctx.addCookies(cookies);
    const raw = await ctx.newPage();
    await raw.goto('http://localhost:3100/admin/sql');
    const first = (await raw.getByTestId('admin-sql-editor').boundingBox())
      ?.height;
    expect(first).toBeGreaterThanOrEqual(178);
    expect(Math.abs((first ?? 0) - hydrated)).toBeLessThanOrEqual(1);
  } finally {
    await ctx.close();
  }
});

test('Structure lists rows without a Size column and labels the total', async ({
  page,
}) => {
  await page.goto('/structure');
  await expect(page.getByRole('columnheader', { name: 'Rows' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Size' })).toHaveCount(0);
  await expect(
    page.getByRole('cell', { name: 'Rows across views' }),
  ).toBeVisible();
});

test('the app icon is served, signed in or not (no favicon 404)', async ({
  page,
  browser,
}) => {
  const missing: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404) missing.push(r.url());
  });
  await page.goto('/');
  const href = await page
    .locator('link[rel="icon"]')
    .first()
    .getAttribute('href');
  expect(href).toMatch(/^\/icon\.svg/);
  await page.waitForLoadState('load');
  expect(missing).toEqual([]);
  const ctx = await browser.newContext();
  try {
    const res = await ctx.request.get(`http://localhost:3100${href}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/svg+xml');
  } finally {
    await ctx.close();
  }
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

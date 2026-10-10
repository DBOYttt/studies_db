import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('anonymous visitors are sent to login info', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login-info/);
  await expect(page.getByText('wpisz /link')).toBeVisible();
});

test('browse, preview, search and sql console', async ({ page }) => {
  const link = `/auth/callback?token=${process.env.E2E_TOKEN}`;
  // A Discord link preview / mail scanner fetching the link must not burn it.
  for (let n = 0; n < 2; n++) {
    const preview = await page.request.get(link, { maxRedirects: 0 });
    expect(preview.status()).toBe(200);
    expect(preview.headers()['set-cookie']).toBeUndefined();
  }
  await page.goto(link);
  await expect(
    page.getByRole('heading', { name: 'Zaloguj się do Studies DB' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('heading', { name: 'Fizyka techniczna' }),
  ).toBeVisible();

  await page.getByRole('link', { name: /Fizyka techniczna/ }).click();
  await page.getByRole('link', { name: 'Kolokwium 1 — tarcie' }).click();

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  // The PDF page is sized to its container, not a fixed 720 px.
  await page.setViewportSize({ width: 375, height: 800 });
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeLessThanOrEqual(375);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeGreaterThan(375);
  await expect(page.getByText('Przetwarzanie…')).toBeVisible();
  await expect(page.getByText('Podgląd niedostępny')).toBeVisible();

  const failedCard = page.locator('li', { hasText: 'prezentacja.pptx' });
  const href = await failedCard
    .getByRole('link', { name: 'Pobierz' })
    .getAttribute('href');
  const res = await page.request.get(href as string);
  expect(res.status()).toBe(200);
  await expect(
    failedCard.getByRole('link', { name: 'Otwórz w Discordzie' }),
  ).toHaveAttribute(
    'href',
    'https://discord.com/channels/e2eguild/e2e-thread/m3',
  );

  await page.goto('/search?q=tarcie');
  await expect(page.locator('mark').first()).toBeVisible();

  await page.goto('/sql');
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('SELECT 1 AS x');
  await page.getByRole('button', { name: 'Uruchom' }).click();
  await expect(
    page.getByRole('cell', { name: '1', exact: true }),
  ).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Eksport CSV/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^zapytanie-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/,
  );
  const csv = await readFile((await download.path()) as string, 'utf8');
  expect(csv).toContain('x');
  expect(csv).toContain('1');

  // A non-JSON error (e.g. tunnel 502 page) is a server error, not a logout.
  await page.route('**/api/sql', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'text/html',
      body: '<html>Bad gateway</html>',
    }),
  );
  await page.getByRole('button', { name: 'Uruchom' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Błąd serwera (502).' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/sql$/);
  await expect(editor).toHaveText('SELECT 1 AS x');
  await page.unroute('**/api/sql');

  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('DELETE FROM v_subjects');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /\S/ })
      .filter({ hasNotText: 'Błąd serwera' }),
  ).toBeVisible();
});

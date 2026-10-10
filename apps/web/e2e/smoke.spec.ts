import { expect, test } from '@playwright/test';

test('anonymous visitors are sent to login info', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login-info/);
  await expect(page.getByText('wpisz /link')).toBeVisible();
});

test('browse, preview, search and sql console', async ({ page }) => {
  await page.goto(`/auth/callback?token=${process.env.E2E_TOKEN}`);
  await expect(
    page.getByRole('heading', { name: 'Fizyka techniczna' }),
  ).toBeVisible();

  await page.getByRole('link', { name: /Fizyka techniczna/ }).click();
  await page.getByRole('link', { name: 'Kolokwium 1 — tarcie' }).click();

  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
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

  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('DELETE FROM v_subjects');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByRole('alert')).toBeVisible();
});

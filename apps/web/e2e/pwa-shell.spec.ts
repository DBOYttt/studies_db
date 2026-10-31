import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

loginOnce('pwa-shell', process.env.E2E_TOKEN_PWA_SHELL, { mode: 'simple' });

test.use({ userAgent: IPHONE_SAFARI, hasTouch: true, isMobile: true });

for (const mode of ['simple', 'advanced'] as const) {
  test(`${mode} top bar: Install app opens the iOS guide`, async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: 'studiesdb.mode', value: mode, domain: 'localhost', path: '/' },
    ]);
    await page.goto(mode === 'simple' ? '/s' : '/');
    const button = page
      .getByRole('banner')
      .getByRole('button', { name: 'Install app' });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await button.click();
    await expect(
      page.getByRole('dialog', { name: 'Install Studies DB' }),
    ).toBeVisible();
  });
}

test('a page load refreshes the session cookie to 400 days', async ({
  page,
  context,
}) => {
  await page.goto('/s');
  const sid = (await context.cookies()).find((c) => c.name === 'sid');
  expect(sid?.expires).toBeGreaterThan(Date.now() / 1000 + 399 * 24 * 3600);
});

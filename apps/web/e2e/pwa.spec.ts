import { type BrowserContext, expect, test } from '@playwright/test';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1';

/** Makes the page believe it runs as the installed app. */
async function asInstalledApp(context: BrowserContext) {
  await context.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q: string) =>
      q.includes('display-mode: standalone')
        ? ({ ...real(q), matches: true, media: q } as MediaQueryList)
        : real(q);
  });
}

const install = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Install app' });

test('manifest and icons load without a session', async ({ request }) => {
  const m = await request.get('/manifest.webmanifest', { maxRedirects: 0 });
  expect(m.status()).toBe(200);
  expect(m.headers()['content-type']).toContain('application/manifest+json');
  expect((await m.json()).display).toBe('standalone');
  for (const icon of [
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
    '/apple-icon.png',
  ]) {
    const r = await request.get(icon, { maxRedirects: 0 });
    expect(r.status(), icon).toBe(200);
    expect(r.headers()['content-type'], icon).toBe('image/png');
  }
});

test('the sign-in page links the manifest and the iOS icon', async ({
  page,
}) => {
  await page.goto('/login-info');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    '#235a81',
  );
});

test('desktop browser without an install offer: no button', async ({
  page,
}) => {
  await page.goto('/login-info');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(install(page)).toHaveCount(0);
});

test.describe('iPhone Safari', () => {
  test.use({ userAgent: IPHONE_SAFARI, hasTouch: true, isMobile: true });

  test('the button opens the Add to Home Screen guide', async ({ page }) => {
    await page.goto('/login-info');
    await install(page).click();
    const dialog = page.getByRole('dialog', { name: 'Install Studies DB' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Add to Home Screen');
    await expect(dialog).not.toContainText('Open this page in Safari');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test.describe('iPhone Chrome', () => {
  test.use({ userAgent: IPHONE_CHROME, hasTouch: true, isMobile: true });

  test('the guide says to open the page in Safari', async ({ page }) => {
    await page.goto('/login-info');
    await install(page).click();
    const dialog = page.getByRole('dialog', { name: 'Install Studies DB' });
    await expect(dialog).toContainText('Open this page in Safari');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe('installed app', () => {
  test.use({ userAgent: IPHONE_SAFARI, hasTouch: true, isMobile: true });

  test('no install button; a pasted sign-in link signs the app in', async ({
    page,
    context,
  }) => {
    await asInstalledApp(context);
    await page.goto('/login-info');
    const field = page.getByLabel('Paste your sign-in link');
    await expect(field).toBeVisible();
    await expect(install(page)).toHaveCount(0);

    await field.fill('https://evil.example/auth/callback?token=abc');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByText('This is not a Studies DB sign-in link.'),
    ).toBeVisible();

    await field.fill(
      `<http://localhost:3100/auth/callback?token=${process.env.E2E_TOKEN_PWA}>`,
    );
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/auth\/callback\?token=/);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).not.toHaveURL(/login-info|auth\/callback/);
    // Signed in, inside the app: the shell has no install button either.
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(install(page)).toHaveCount(0);
    const sid = (await context.cookies()).find((c) => c.name === 'sid');
    expect(sid?.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 24 * 3600);
  });
});

test('Chromium finds and parses the manifest without errors', async ({
  page,
  context,
}) => {
  await page.goto('/login-info');
  const cdp = await context.newCDPSession(page);
  const m = (await cdp.send('Page.getAppManifest')) as {
    url: string;
    errors: unknown[];
    manifest?: { display: string; icons?: { url: string }[] };
  };
  expect(m.url).toBe('http://localhost:3100/manifest.webmanifest');
  expect(m.errors).toEqual([]);
  expect(m.manifest?.display).toBe('kStandalone');
  expect(m.manifest?.icons?.length).toBe(3);
});

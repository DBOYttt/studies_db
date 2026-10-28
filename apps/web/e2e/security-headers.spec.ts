import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

test('pages carry the security headers and no X-Powered-By', async ({
  request,
}) => {
  const res = await request.get('/login-info', { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['x-powered-by']).toBeUndefined();
  // Plain-HTTP dev server: HSTS is production-only.
  expect(h['strict-transport-security']).toBeUndefined();
});

test('the login confirmation keeps its stricter route headers', async ({
  request,
}) => {
  const res = await request.get('/auth/callback?token=not-a-token', {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h['content-security-policy']).toMatch(/^default-src 'none';/);
  expect(h['referrer-policy']).toBe('same-origin');
  expect(h['x-frame-options']).toBe('DENY');
});

test('a cross-origin logout is refused', async ({ request }) => {
  const res = await request.post('/auth/logout', {
    headers: { Origin: 'http://evil.example' },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(403);
});

test.describe('signed in', () => {
  loginOnce('headers', process.env.E2E_TOKEN_HEADERS);

  test('PDF preview, Designer and SQL console run under the CSP', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __csp: string[] };
      w.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    const consoleCsp: string[] = [];
    page.on('console', (m) => {
      if (/Content[ -]Security[ -]Policy/i.test(m.text())) {
        consoleCsp.push(m.text());
      }
    });
    const violations = async () =>
      page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

    await page.goto('/subjects/FIZ');
    const main = page.getByRole('main');
    await main
      .getByRole('link', { name: 'Kolokwium 1 — tarcie' })
      .first()
      .click();
    await main.getByRole('link', { name: 'sample.pdf' }).click();
    const panel = page.getByRole('complementary', { name: 'File preview' });
    await expect(panel.locator('canvas').first()).toBeVisible({
      timeout: 30_000,
    });
    expect(await violations()).toEqual([]);

    await page.goto('/schema');
    await expect(
      page.getByRole('link', { name: /^Table v_files,/ }),
    ).toBeVisible();
    expect(await violations()).toEqual([]);

    await page.goto('/sql');
    await expect(page.locator('.cm-editor').first()).toBeVisible();
    expect(await violations()).toEqual([]);

    await page.goto('/s/plan');
    await expect(page.getByRole('main')).toBeVisible();
    expect(await violations()).toEqual([]);
    expect(consoleCsp).toEqual([]);
  });
});

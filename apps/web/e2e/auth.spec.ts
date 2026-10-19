import { type APIRequestContext, expect, test } from '@playwright/test';

// Next parses Next-Router-State-Tree as JSON.parse(decodeURIComponent(header)).
// A segment is a string or, for dynamic ones, [param, value, type, siblings].
const tree = (segments: unknown[]) => {
  let node: unknown = ['__PAGE__', {}];
  for (const s of [...segments].reverse()) node = [s, { children: node }];
  return encodeURIComponent(JSON.stringify(['', { children: node }]));
};

/**
 * GET with RSC headers. Next 16 first answers RSC requests lacking a matching
 * `_rsc` cache-busting param with a 307 to `<path>?_rsc=<hash>`; an attacker
 * just follows it, so we do too (keeping the headers). Any other redirect is
 * returned as is.
 */
async function rscGet(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>,
) {
  const first = await request.get(path, { headers, maxRedirects: 0 });
  const loc = first.headers().location ?? '';
  if (first.status() === 307 && loc.startsWith(`${path}?_rsc=`)) {
    return request.get(loc, { headers, maxRedirects: 0 });
  }
  return first;
}

// RSC navigation requests that claim the (app) layout is already mounted
// skip rendering it, so the layout's requireUser() must not be the only gate.
// Each tree claims the client is on another (app) page, i.e. the layout is
// already mounted, so Next renders only the target page.
const cases = [
  {
    path: '/sql',
    tree: tree(['(app)']),
    secrets: ['v_subjects', 'display_name', 'Konsola SQL', 'SQL console'],
  },
  {
    path: '/tables/v_users',
    tree: tree(['(app)']),
    secrets: ['v_subjects', 'Ewa Testowa', 'display_name'],
  },
  {
    path: '/',
    tree: tree(['(app)', 'sql']),
    secrets: ['Fizyka techniczna'],
  },
];

for (const { path, tree: t, secrets } of cases) {
  test(`RSC request for ${path} without a cookie is redirected`, async ({
    request,
  }) => {
    const res = await rscGet(request, path, {
      RSC: '1',
      'Next-Router-State-Tree': t,
    });
    expect([303, 307]).toContain(res.status());
    expect(res.headers().location).toMatch(/^\/login-info/);
    const body = await res.text();
    for (const s of secrets) expect(body).not.toContain(s);
  });

  test(`RSC request for ${path} with a bogus cookie leaks nothing`, async ({
    request,
  }) => {
    const res = await rscGet(request, path, {
      RSC: '1',
      'Next-Router-State-Tree': t,
      Cookie: 'sid=not-a-real-session',
    });
    expect(res.status()).not.toBe(500);
    const body = await res.text();
    for (const s of secrets) expect(body).not.toContain(s);
  });
}

test('plain requests without a cookie are redirected by the proxy', async ({
  request,
}) => {
  for (const path of ['/', '/sql', '/tables/v_users', '/api/schema']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(307);
    expect(res.headers().location, path).toBe('/login-info');
  }
  const info = await request.get('/login-info', { maxRedirects: 0 });
  expect(info.status()).toBe(200);
  const worker = await request.get('/pdf.worker.min.mjs', { maxRedirects: 0 });
  expect(worker.status()).toBe(200);
});

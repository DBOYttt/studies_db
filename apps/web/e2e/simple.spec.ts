import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

// No advanced cookie: this spec exercises the default simple view.
loginOnce('simple', process.env.E2E_TOKEN_SIMPLE, { mode: 'simple' });

test('fresh login without a mode cookie lands on /s', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'pl-PL' });
  try {
    const page = await context.newPage();
    await page.goto(
      `http://localhost:3100/auth/callback?token=${process.env.E2E_TOKEN_SIMPLE_LANDING}`,
    );
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/localhost:3100\/s$/);
  } finally {
    await context.close();
  }
});

test('login lands on Start with subject cards and Recently added', async ({
  page,
}) => {
  await page.goto('/s');
  await expect(
    page.getByRole('heading', { name: 'Subjects' }).first(),
  ).toBeVisible();
  const main = page.getByRole('main');
  // What's next first: Upcoming events sit above the subject grid.
  const events = await main
    .getByRole('heading', { name: 'Upcoming events' })
    .boundingBox();
  const subjects = await main
    .getByRole('heading', { name: 'Subjects' })
    .boundingBox();
  expect(events?.y).toBeLessThan(subjects?.y ?? 0);
  for (const code of ['FIZ', 'MECH', 'PLAN']) {
    await expect(
      main.getByRole('link', { name: new RegExp(`^${code}\\b`) }),
    ).toBeVisible();
  }
  const recentHeading = main.getByRole('heading', { name: 'Recently added' });
  await expect(recentHeading).toBeVisible();
  await expect(
    recentHeading
      .locator('xpath=following-sibling::ul[1]')
      .getByRole('link', { name: 'wyklad-slajdy.pdf', exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole('link', { name: /^PLAN\b/ }).getByText('no files'),
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

  await expect(
    main.getByRole('link', { name: 'wyklad-slajdy.pdf', exact: true }),
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

  const panel = page.getByRole('complementary', { name: 'File preview' });
  const opener = main.getByRole('link', {
    name: 'Preview file lab-sprawozdanie.pdf',
  });
  await opener.click();
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/file=\d+/);
  // Opening the preview moves focus into it.
  await expect(
    panel.getByRole('heading', { name: 'File preview' }),
  ).toBeFocused();
  await expect(panel.getByRole('link', { name: 'Download' })).toHaveAttribute(
    'href',
    /^\/files\/\d+\/original$/,
  );

  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await expect(page).not.toHaveURL(/file=/);
  await expect(page).toHaveURL(/group=3/);
  // Closing returns focus to the link that opened the preview.
  await expect(opener).toBeFocused();
});

test('empty subject shows the empty state', async ({ page }) => {
  await page.goto('/s/subjects/PLAN');
  await expect(page.getByText('No files in this subject.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Files (0)' })).toBeVisible();
});

test('search highlights hits with <mark>', async ({ page }) => {
  await page.goto('/s/search?q=lab');
  const marks = page.getByRole('main').locator('mark');
  await expect(marks.first()).toBeVisible();
  await expect(marks.first()).toHaveText(/lab/i);
  // No inline padding, so a hit inside a word doesn't split it.
  await expect(marks.first()).toHaveCSS('padding-left', '0px');
  await expect(marks.first()).toHaveCSS('padding-right', '0px');
});

test('search shows the text snippet and counts files and topics', async ({
  page,
}) => {
  await page.goto('/s/search?q=wspolczynnik');
  const main = page.getByRole('main');
  await expect(main.getByText('1 file, 0 topics')).toBeVisible();
  // The text hit ("Współczynnik", diacritics folded) is shown and marked.
  await expect(main.locator('li mark').first()).toHaveText('Współczynnik');
  await expect(main.getByText(/tarcia: tarcie statyczne/)).toBeVisible();
  // A topic hit is counted and points to Advanced, which lists it.
  await page.goto('/s/search?q=tarcie');
  await expect(main.getByText(/\d+ files?, 1 topic\b/)).toBeVisible();
  await expect(
    main.getByRole('link', { name: 'Show topics in Advanced' }),
  ).toHaveAttribute(
    'href',
    /^\/mode\?to=advanced&next=%2Fsearch%3Fq%3Dtarcie$/,
  );
});

test('event kinds are line icons, named for screen readers', async ({
  page,
}) => {
  await page.goto('/s/plan?week=2026-W39');
  const block = page
    .getByTestId('plan-event')
    .filter({ hasText: 'Niedzielne konsultacje' });
  await expect(block).toHaveAccessibleName(/Other: Niedzielne konsultacje/);
  await expect(block.locator('svg')).toHaveCount(1);
  await expect(block).not.toContainText('📌');
});

test('reports: card shows table with Author header and CSV link', async ({
  page,
}) => {
  await page.goto('/s/reports');
  await page.getByRole('link', { name: /Most active uploaders/ }).click();
  await expect(page).toHaveURL(/r=1/);
  await expect(
    page.getByRole('columnheader', { name: 'Author' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Download CSV' }),
  ).toHaveAttribute('href', '/s/reports/csv?r=1');
});

test('Timetable from the sidebar shows week blocks', async ({ page }) => {
  await page.goto('/s');
  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('link', { name: 'Timetable' })
    .click();
  await expect(page).toHaveURL(/\/s\/plan/);
  await page.goto('/s/plan?week=2026-W42');
  await expect(page.getByTestId('plan-block')).toHaveCount(4);
});

test('mode switch round trip keeps the chosen mode', async ({ page }) => {
  await page.goto('/s/subjects/MECH');
  const switcher = page.getByRole('navigation', { name: 'View mode' });
  await switcher.getByRole('link', { name: 'Advanced' }).click();
  await expect(page).toHaveURL(/\/subjects\/MECH/);
  await expect(page).not.toHaveURL(/\/s\//);

  await page.reload();
  await expect(page).toHaveURL(/\/subjects\/MECH/);
  await page.goto('/');
  await expect(page).toHaveURL(/localhost:3100\/$/);

  await page.goto('/subjects/MECH');
  await page
    .getByRole('navigation', { name: 'View mode' })
    .getByRole('link', { name: 'Simple' })
    .click();
  await expect(page).toHaveURL(/\/s\/subjects\/MECH/);
});

test('/mode rejects a protocol-relative next', async ({ page }) => {
  await page.goto('/mode?to=simple&next=//evil.com');
  await expect(page).toHaveURL(/localhost:3100\/s$/);
});

test('the first Tab shows "Skip to content" and Enter focuses main', async ({
  page,
}) => {
  await page.goto('/s/plan?week=2026-W42');
  await expect(page.getByTestId('plan-block').first()).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

test('streamed pages finish with their headings and no busy placeholder', async ({
  page,
  context,
}) => {
  await page.goto('/s');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Start' })).toBeAttached();
  await expect(
    main.getByRole('heading', { name: 'Upcoming events' }),
  ).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

  await page.goto('/s/plan');
  await expect(
    page.getByRole('heading', { name: 'Timetable', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Week timetable' }),
  ).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

  await context.addCookies([
    { name: 'studiesdb.mode', value: 'advanced', url: 'http://localhost:3100' },
  ]);
  await page.goto('/plan');
  await expect(
    page.getByRole('heading', { name: 'Timetable', level: 1 }),
  ).toBeAttached();
  await expect(
    page.getByRole('region', { name: 'Week timetable' }),
  ).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});

test('a stale session cookie still redirects before anything streams', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'pl-PL' });
  try {
    await context.addCookies([
      {
        name: 'sid',
        value: 'not-a-real-session',
        url: 'http://localhost:3100',
      },
    ]);
    const page = await context.newPage();
    // /plan: an advanced page behind a loading.tsx boundary.
    for (const path of ['/s', '/s/plan', '/plan']) {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect([303, 307], path).toContain(res.status());
      expect(res.headers().location, path).toMatch(/^\/login-info/);
    }
  } finally {
    await context.close();
  }
});

test("Start shows today's classes above Upcoming events", async ({ page }) => {
  await page.goto('/s');
  const main = page.getByRole('main');
  const today = main.getByRole('region', { name: /^Today/ });
  await expect(today).toBeVisible();
  // The seed has a UKL lecture today, 12:00–13:30 (all users see lectures).
  await expect(
    today.getByRole('link', { name: /12:00–13:30.*Układ zajęć/ }),
  ).toBeVisible();
  const t = await today.boundingBox();
  const u = await main
    .getByRole('heading', { name: 'Upcoming events' })
    .boundingBox();
  expect(t?.y).toBeLessThan(u?.y ?? 0);
});

test('"See all events" opens the events index with the upcoming events', async ({
  page,
}) => {
  await page.goto('/s');
  await page
    .getByRole('region', { name: 'Upcoming events' })
    .getByRole('link', { name: 'See all events' })
    .click();
  await expect(page).toHaveURL(/\/s\/wydarzenia$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Events' }),
  ).toBeVisible();
  const list = page.getByRole('list', { name: 'Upcoming events' });
  // Seeded far ahead (26 Jan 2027); the past seeded events are not listed.
  await expect(
    list.getByRole('link', { name: /Kolokwium audytu/ }),
  ).toBeVisible();
  await expect(list.getByText('Kolokwium z ocen')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Add event' })).toHaveAttribute(
    'href',
    '/s/wydarzenia/nowe',
  );
});

test('the advanced events index and the mode switch', async ({ page }) => {
  await page.goto('/mode?to=advanced&next=%2Fs%2Fwydarzenia');
  await expect(page).toHaveURL(/\/wydarzenia$/);
  await expect(
    page.getByRole('link', { name: /Kolokwium audytu/ }),
  ).toHaveAttribute('href', /^\/wydarzenia\/\d+$/);
});

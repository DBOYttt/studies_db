import { expect, type Locator, type Page, test } from '@playwright/test';
import { loginOnce } from './session';

// Phone width (mobile QA persona): nothing scrolls sideways, and the
// controls the UX audit found wrapping stay on one line.
loginOnce('mobile', process.env.E2E_TOKEN_MOBILE, { mode: 'simple' });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

const eventPage = () => `/s/wydarzenia/${process.env.E2E_AUDIT_EVENT_ID}`;

async function expectNoSidewaysScroll(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(375);
}

test('pages fit 375 px without sideways scrolling', async ({ page }) => {
  for (const path of [
    '/s',
    '/s/plan',
    '/s/subjects/FIZ',
    eventPage(),
    '/s/wydarzenia/nowe',
    '/s/wydarzenia',
    '/s/search?q=tarcie',
  ]) {
    await page.goto(path);
    await expectNoSidewaysScroll(page);
  }
});

test('the preview fits and its PDF toolbar is one row', async ({ page }) => {
  await page.goto('/s/subjects/FIZ');
  await page.getByRole('link', { name: 'Preview file sample.pdf' }).click();
  const toolbar = page.getByTestId('pdf-toolbar');
  await expect(toolbar).toBeVisible();
  await expectNoSidewaysScroll(page);
  const tops = await toolbar
    .locator('button, span')
    .evaluateAll((els) =>
      els
        .filter((e) => e.getClientRects().length > 0)
        .map((e) =>
          Math.round(
            e.getBoundingClientRect().top +
              e.getBoundingClientRect().height / 2,
          ),
        ),
    );
  expect(tops.length).toBeGreaterThanOrEqual(5);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  await expect(
    toolbar.getByRole('group', { name: 'Zoom' }).getByText('100%'),
  ).toBeVisible();
});

test('file meta values never break inside', async ({ page }) => {
  await page.goto('/s/subjects/FIZ');
  const values = page.locator('main li .whitespace-nowrap');
  await expect(values.first()).toBeVisible();
  for (const v of await values.all()) {
    const lines = await v.evaluate((e) => e.getClientRects().length);
    expect(lines).toBe(1);
  }
});

test('the header shows the current crumb whole, a back link and both mode labels', async ({
  page,
}) => {
  await page.goto('/s/wydarzenia/nowe');
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  const current = crumbs.locator('[aria-current="page"]');
  await expect(current).toHaveText('Add event');
  expect(await current.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await expect(crumbs.getByRole('link', { name: /^Back to / })).toBeVisible();
  const mode = page.getByRole('navigation', { name: 'View mode' });
  await expect(mode.getByText('Simple')).toBeVisible();
  await expect(mode.getByText('Advanced')).toBeVisible();
});

test('the delete question gets its own row; Edit and Delete stay put', async ({
  page,
}) => {
  await page.goto(eventPage());
  const edit = page.getByRole('link', { name: 'Edit', exact: true });
  const del = page.getByRole('button', { name: 'Delete', exact: true });
  const before = [await edit.boundingBox(), await del.boundingBox()];
  await expect(async () => {
    await del.click();
    await expect(
      page.getByRole('group', { name: 'Delete this event?' }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass();
  const group = page.getByRole('group', { name: 'Delete this event?' });
  expect([await edit.boundingBox(), await del.boundingBox()]).toEqual(before);
  const groupBox = await group.boundingBox();
  expect(groupBox?.y).toBeGreaterThan(
    (before[1]?.y ?? 0) + (before[1]?.height ?? 0),
  );
  await expectNoSidewaysScroll(page);
  await group.getByRole('button', { name: 'Cancel' }).click();
  await expect(group).toHaveCount(0);
});

test('a field scrolled to the top edge keeps its label in view', async ({
  page,
}) => {
  // Native validation scrolls the empty Title to the top of the scroller
  // (as scrollIntoView does); scroll-margin-top keeps its label visible.
  // A short viewport (keyboard open) lets the form scroll that far.
  await page.setViewportSize({ width: 375, height: 420 });
  await page.goto('/s/wydarzenia/nowe');
  const main = page.getByRole('main');
  await main.evaluate((m) => {
    m.scrollTop = m.scrollHeight;
  });
  const title = page.getByLabel('Title', { exact: true });
  await title.evaluate((e) => e.scrollIntoView());
  // The label wraps the input: its text is the top of the label box.
  const label = page.locator('label', { hasText: /^Title/ }).first();
  const [m, l] = await Promise.all([main.boundingBox(), label.boundingBox()]);
  expect(await main.evaluate((x) => x.scrollTop)).toBeGreaterThan(0);
  expect(l?.y ?? -1).toBeGreaterThanOrEqual(m?.y ?? 0);
});

test("the week opens scrolled to today's column", async ({ page }) => {
  // The seed has a UKL lecture today, so the current week has a grid. The
  // plan may open on next week once this one is over: "Today" opens this one.
  await page.goto('/s/plan');
  await page
    .getByRole('navigation', { name: 'Weeks' })
    .getByRole('link', { name: 'Today' })
    .click();
  const scroller = page.getByTestId('plan-scroller');
  const today = page.getByTestId('plan-day').filter({ hasText: '(today)' });
  await expect(today).toHaveCount(1);
  await expect
    .poll(async () => {
      const s = await scroller.boundingBox();
      const t = await today.boundingBox();
      if (!s || !t) return false;
      // Fully inside the scroller's visible part (past the hour gutter).
      return t.x >= s.x && t.x + t.width <= s.x + s.width + 1;
    })
    .toBe(true);
});

/** The top bar controls of a shell (simple or advanced). */
function topBarControls(page: Page) {
  const bar = page.locator('header').first();
  const mode = page.getByRole('navigation', { name: 'View mode' });
  return {
    menu: bar.getByRole('button', { name: 'Open navigation panel' }),
    simple: mode.getByText('Simple'),
    advanced: mode.getByText('Advanced'),
    signOut: bar.getByRole('button', { name: 'Sign out' }),
  };
}

const heightOf = async (l: Locator) => (await l.boundingBox())?.height ?? 0;

test('top bar controls are at least 44 px tall on a phone', async ({
  page,
}) => {
  await page.goto('/s/wydarzenia/nowe');
  const simple = topBarControls(page);
  const back = page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: /^Back to / });
  for (const l of [...Object.values(simple), back]) {
    expect(await heightOf(l)).toBeGreaterThanOrEqual(44);
  }
  await page.goto('/plan');
  for (const l of Object.values(topBarControls(page))) {
    expect(await heightOf(l)).toBeGreaterThanOrEqual(44);
  }
});

test('timetable, event and preview controls are at least 44 px tall on a phone', async ({
  page,
}) => {
  await page.goto('/s/plan');
  const weeks = page.getByRole('navigation', { name: 'Weeks' });
  const views = page.getByRole('navigation', { name: 'Timetable view' });
  for (const l of [
    weeks.getByRole('link', { name: '‹ Previous' }),
    weeks.getByRole('link', { name: 'Next ›' }),
    views.getByRole('link', { name: 'Week' }),
    views.getByRole('link', { name: 'My groups' }),
  ]) {
    expect(await heightOf(l)).toBeGreaterThanOrEqual(44);
  }
  await page.goto(eventPage());
  for (const l of [
    page.getByRole('link', { name: 'Edit', exact: true }),
    page.getByRole('button', { name: 'Delete', exact: true }),
    page.getByRole('button', { name: 'Search', exact: true }),
  ]) {
    expect(await heightOf(l)).toBeGreaterThanOrEqual(44);
  }
  await page.goto('/s/subjects/FIZ');
  await page.getByRole('link', { name: 'Preview file sample.pdf' }).click();
  const buttons = page.getByTestId('pdf-toolbar').getByRole('button');
  await expect(buttons).toHaveCount(4);
  for (const l of await buttons.all()) {
    expect(await heightOf(l)).toBeGreaterThanOrEqual(44);
  }
});

test('the desktop top bar keeps its control heights', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Heights before the phone tap targets (2026-10-30), +1 px of rounding.
  const OLD = {
    simple: { simple: 22, advanced: 22, signOut: 19.5 },
    advanced: { simple: 22, advanced: 22, signOut: 19.5 },
  };
  await page.goto('/s/wydarzenia/nowe');
  const s = topBarControls(page);
  const sh = {
    simple: await heightOf(s.simple),
    advanced: await heightOf(s.advanced),
    signOut: await heightOf(s.signOut),
  };
  await page.goto('/plan');
  const a = topBarControls(page);
  const ah = {
    simple: await heightOf(a.simple),
    advanced: await heightOf(a.advanced),
    signOut: await heightOf(a.signOut),
  };
  for (const k of ['simple', 'advanced', 'signOut'] as const) {
    expect(sh[k]).toBeGreaterThan(0);
    expect(sh[k]).toBeLessThanOrEqual(OLD.simple[k] + 1);
    expect(ah[k]).toBeGreaterThan(0);
    expect(ah[k]).toBeLessThanOrEqual(OLD.advanced[k] + 1);
  }
});

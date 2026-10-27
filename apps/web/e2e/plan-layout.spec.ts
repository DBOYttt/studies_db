import { expect, type Page, test } from '@playwright/test';
import { loginOnce } from './session';

loginOnce('plan-layout', process.env.E2E_TOKEN_PLAN_LAYOUT, {
  mode: 'simple',
});

/** UKL week (global-setup): quiz + Test blocks, overlaps, weekend events. */
const WEEK = '/s/plan?week=2026-W39';

type Box = { left: number; top: number; right: number; bottom: number };

const block = (page: Page, room: string) =>
  page.getByTestId('plan-block').filter({ hasText: room });

/** Opens a block's session panel (a click only works once hydrated). */
async function openPanel(page: Page, room: string) {
  const panel = page.getByRole('complementary', { name: 'Class details' });
  await expect(async () => {
    // Near the top: the lower part of the block holds the bars.
    await block(page, room)
      .locator('[data-block-main]')
      .click({ position: { x: 8, y: 8 } });
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();
  return panel;
}

/**
 * Every footer bar lies inside its block, and the subject code and class
 * line boxes don't intersect any bar.
 */
async function expectBarsInsideBlocks(page: Page) {
  const blocks = await page.evaluate(() => {
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    return [...document.querySelectorAll('[data-testid="plan-block"]')].map(
      (b) => ({
        text: b.textContent ?? '',
        block: box(b),
        bars: [...b.querySelectorAll('[data-testid="badge-bars"] > *')].map(
          box,
        ),
        lines: [...b.querySelectorAll('[data-block-line]')].map(box),
      }),
    );
  });
  const withBars = blocks.filter((b) => b.bars.length > 0);
  expect(withBars.length).toBeGreaterThanOrEqual(3);
  const inside = (a: Box, b: Box) =>
    a.left >= b.left - 0.5 &&
    a.right <= b.right + 0.5 &&
    a.top >= b.top - 0.5 &&
    a.bottom <= b.bottom + 0.5;
  const overlaps = (a: Box, b: Box) =>
    a.left < b.right &&
    b.left < a.right &&
    a.top < b.bottom &&
    b.top < a.bottom;
  for (const b of withBars) {
    expect(b.lines.length, b.text).toBe(2);
    for (const bar of b.bars) {
      expect(inside(bar, b.block), `bar inside block: ${b.text}`).toBe(true);
      for (const line of b.lines)
        expect(overlaps(line, bar), `line clear of bar: ${b.text}`).toBe(false);
    }
  }
}

for (const width of [1440, 375]) {
  test(`footer bars stay inside their blocks at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(WEEK);
    // 90-min block with a quiz and a Test, beside an event: one merged bar.
    const merged = block(page, 'U-1 101').getByTestId('badge-bars');
    await expect(merged.locator('> *')).toHaveCount(1);
    await expect(
      merged.getByRole('button', {
        name: 'Entry quiz: Rozdział 5. Test: Kolokwium układu',
      }),
    ).toBeVisible();
    // 105-min block: both bars.
    const both = block(page, 'U-1 102').getByTestId('badge-bars');
    await expect(both.locator('> *')).toHaveCount(2);
    await expect(
      both.getByRole('link', { name: 'Test: Kolokwium drugie' }),
    ).toBeVisible();
    // Quiz only, beside a lecture: one bar, named in full even when short.
    await expect(
      block(page, 'U-1 103').getByRole('button', {
        name: 'Entry quiz: Rozdział 5',
      }),
    ).toBeVisible();
    await expectBarsInsideBlocks(page);
  });
}

test('the current week does not widen the page at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/s/plan');
  await expect(block(page, 'U-1 105')).toBeVisible();
  await expect(page.getByTestId('plan-day').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  // Whatever today's weekday: the sr-only "(today)" is placed inside its
  // header cell, so it can't reach past the scroller's clip.
  const marker = page.getByTestId('plan-day').getByText('(today)');
  await expect(marker).toHaveCount(1);
  expect(
    await marker.evaluate(
      (e) =>
        (e as HTMLElement).offsetParent?.getAttribute('data-testid') ?? null,
    ),
  ).toBe('plan-day');
});

test('with the panel open at 1440 every day column stays in view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(WEEK);
  const days = page.getByTestId('plan-day');
  await expect(days).toHaveCount(7);
  const panel = await openPanel(page, 'U-1 101');
  await expect(
    panel.getByRole('heading', {
      level: 2,
      name: 'UKL · Laboratorium Gr. 1 · Tue 22 Sep',
    }),
  ).toBeFocused();

  const scroller = page.getByTestId('plan-scroller');
  const s = await scroller.boundingBox();
  const p = await panel.boundingBox();
  if (!s || !p) throw new Error('no scroller or panel box');
  expect(
    await scroller.evaluate((e) => e.scrollWidth - e.clientWidth),
  ).toBeLessThanOrEqual(0);
  for (const day of await days.all()) {
    const d = await day.boundingBox();
    if (!d) throw new Error('no day box');
    expect(d.x).toBeGreaterThanOrEqual(s.x - 0.5);
    expect(d.x + d.width).toBeLessThanOrEqual(s.x + s.width + 0.5);
    expect(d.x + d.width).toBeLessThanOrEqual(p.x);
  }
  await expectBarsInsideBlocks(page);
});

test('the panel: heading, no repeated description, "Add test", tests, bar state', async ({
  page,
}) => {
  await page.goto(WEEK);
  const panel = await openPanel(page, 'U-1 101');
  // The label "Laboratorium gr 1" only repeats the Class row.
  await expect(
    panel.getByRole('rowheader', { name: 'Description' }),
  ).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Add test' })).toHaveText(
    'Add test',
  );
  await expect(
    panel.getByRole('list', { name: 'Tests' }).getByRole('link'),
  ).toHaveAccessibleName('Kolokwium układu');
  const merged = block(page, 'U-1 101').getByRole('button', {
    name: /^Entry quiz: Rozdział 5\. Test/,
  });
  await expect(merged).toHaveAttribute('aria-expanded', 'true');
  await expect(merged).toHaveAttribute('aria-controls', 'session-panel');
  await expect(panel).toHaveAttribute('id', 'session-panel');

  const legend = page.getByRole('list', { name: 'Class types' });
  await expect(legend.getByText('Test', { exact: true })).toBeVisible();
  await expect(legend.getByText('Entry quiz', { exact: true })).toBeVisible();
});

test('"Not this week" in the panel offers an Undo that restores the bar', async ({
  page,
}) => {
  await page.goto(WEEK);
  const b = block(page, 'U-1 102');
  await expect(b.getByRole('button', { name: /^Entry quiz/ })).toBeVisible();
  const panel = await openPanel(page, 'U-1 102');
  await panel
    .getByRole('button', { name: 'Not this week (all groups)' })
    .click();
  const undo = panel.getByRole('button', { name: 'Undo skip on Wed 23 Sep' });
  await expect(undo).toBeFocused();
  await expect(
    panel.getByText('Entry quiz skipped', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText(
    'Entry quiz skipped on Wed 23 Sep.',
  );
  await expect(b.getByRole('button', { name: /^Entry quiz/ })).toHaveCount(0);
  await expect(
    b.getByRole('link', { name: 'Test: Kolokwium drugie' }),
  ).toBeVisible();

  await undo.click();
  await expect(b.getByRole('button', { name: /^Entry quiz/ })).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Not this week (all groups)' }),
  ).toBeVisible();
  await expect(
    panel.getByText('Entry quiz skipped', { exact: true }),
  ).toHaveCount(0);
});

test('"Not this week" on a bar opens the panel with the Undo', async ({
  page,
}) => {
  await page.goto(WEEK);
  const b = block(page, 'U-1 103');
  const quiz = b.getByRole('button', { name: 'Entry quiz: Rozdział 5' });
  const dialog = page.getByRole('dialog', { name: 'Entry quiz' });
  await expect(async () => {
    await quiz.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await dialog
    .getByRole('button', { name: 'Not this week (all groups)' })
    .click();
  const panel = page.getByRole('complementary', { name: 'Class details' });
  const undo = panel.getByRole('button', { name: 'Undo skip on Thu 24 Sep' });
  await expect(undo).toBeFocused();
  await expect(quiz).toHaveCount(0);
  await undo.click();
  await expect(quiz).toBeVisible();
});

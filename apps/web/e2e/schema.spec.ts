import { expect, type Page, test } from '@playwright/test';
import { loginOnce } from './session';

loginOnce('schema', process.env.E2E_TOKEN_SCHEMA);

const VIEWS = [
  'v_subjects',
  'v_lecturers',
  'v_classes',
  'v_class_groups',
  'v_class_lecturers',
  'v_topics',
  'v_tags',
  'v_topic_tags',
  'v_materials',
  'v_files',
  'v_users',
];

const canvas = (page: Page) =>
  page.getByRole('region', { name: 'Database schema' });
const boxOf = (page: Page, view: string) =>
  page.getByRole('group', {
    name: `${view}, drag the header to move`,
  });
const headerOf = (page: Page, view: string) =>
  boxOf(page, view).getByRole('link', { name: new RegExp(`^Table ${view},`) });

async function rect(page: Page, view: string) {
  const r = await boxOf(page, view).boundingBox();
  if (!r) throw new Error(`no box ${view}`);
  return r;
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Schemat: fit, drag, persist, reset, click, all columns', async ({
    page,
  }) => {
    await page.goto('/schema');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    for (const v of VIEWS) await expect(boxOf(page, v)).toBeVisible();

    // Fitted: the right-most box is fully inside the canvas viewport.
    const c = await canvas(page).boundingBox();
    const files = await rect(page, 'v_files');
    expect(c).not.toBeNull();
    if (!c) return;
    expect(files.x).toBeGreaterThanOrEqual(c.x);
    expect(files.x + files.width).toBeLessThanOrEqual(c.x + c.width);

    // Drag the v_users header: the box follows the pointer.
    const before = await rect(page, 'v_users');
    const h = await headerOf(page, 'v_users').boundingBox();
    if (!h) throw new Error('no header');
    await page.mouse.move(h.x + 40, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 140, h.y + h.height / 2 + 60, { steps: 5 });
    await page.mouse.move(h.x + 240, h.y + h.height / 2 + 120, { steps: 5 });
    await page.mouse.up();
    await expect(page).toHaveURL(/\/schema$/);
    const after = await rect(page, 'v_users');
    expect(after.x - before.x).toBeCloseTo(200, -1);
    expect(after.y - before.y).toBeCloseTo(120, -1);
    // Stored in layout px (screen px / zoom).
    const zoom = before.width / 190;
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('studiesdb.schemaLayout.v1') ?? '{}'),
    );
    expect(stored.v_users[0]).toBeCloseTo(710 + 200 / zoom, -1);
    expect(stored.v_users[1]).toBeCloseTo(340 + 120 / zoom, -1);

    // Survives a reload.
    await page.reload();
    await expect
      .poll(async () => Math.round((await rect(page, 'v_users')).x))
      .toBe(Math.round(after.x));
    expect((await rect(page, 'v_users')).y).toBeCloseTo(after.y, 0);

    // Reset layout restores the default position.
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await expect
      .poll(async () => Math.round((await rect(page, 'v_users')).x))
      .toBe(Math.round(before.x));
    expect(
      await page.evaluate(() =>
        localStorage.getItem('studiesdb.schemaLayout.v1'),
      ),
    ).toBeNull();

    // Keyboard: arrow keys move a focused header.
    await headerOf(page, 'v_users').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem('studiesdb.schemaLayout.v1') ?? '{}',
            ).v_users,
        ),
      )
      .toEqual([726, 404]);
    await page.getByRole('button', { name: 'Reset layout' }).click();

    // Compact columns by default; the toggle shows every column.
    const region = canvas(page);
    await expect(region.getByText('discord_thread_id')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Show all columns' }).check();
    await expect(region.getByText('discord_thread_id')).toBeVisible();

    // Zoom buttons change the box size; Fit fits again.
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect
      .poll(async () => (await rect(page, 'v_users')).width)
      .toBeGreaterThan(before.width + 5);
    await page.getByRole('button', { name: 'Fit' }).click();
    await expect
      .poll(async () => Math.round((await rect(page, 'v_users')).width))
      .toBe(Math.round(before.width));

    // A click without movement still opens the view.
    await headerOf(page, 'v_tags').click();
    await expect(page).toHaveURL(/\/tables\/v_tags$/);
  });
});

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('tapping a header opens the view', async ({ page }) => {
    await page.goto('/schema');
    await headerOf(page, 'v_subjects').tap();
    await expect(page).toHaveURL(/\/tables\/v_subjects$/);
  });
});

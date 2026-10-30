import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

// Semester switcher (simple and advanced): fixtures FIZ (semester 1) and
// SEM3 (semester 3, class + group + a session today + an event ahead).
loginOnce('semesters', process.env.E2E_TOKEN_SEMESTERS, { mode: 'simple' });

const segments = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Semester' });

test('simple: choosing 3 hides semester-1 subjects, the choice sticks, All brings them back', async ({
  page,
}) => {
  await page.goto('/s');
  await expect(
    page.getByRole('link', { name: /Fizyka techniczna/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Semestr trzeci/ }).first(),
  ).toBeVisible();

  await segments(page).getByRole('link', { name: '3', exact: true }).click();
  await expect(page).toHaveURL(/\/s$/);
  await expect(segments(page).locator('[aria-current="page"]')).toHaveText('3');
  await expect(
    page.getByRole('link', { name: /Semestr trzeci/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Fizyka techniczna/ }),
  ).toHaveCount(0);

  // Cookie: the timetable stays filtered without any query parameter.
  await page.goto('/s/plan');
  await expect(page.getByText('Semestr trzeci').first()).toBeVisible();
  await expect(page.getByText('Fizyka inna')).toHaveCount(0);

  // Events index too.
  await page.goto('/s/wydarzenia');
  await expect(page.getByText('Wyjazd trzeciego semestru')).toBeVisible();
  await expect(page.getByText('Kolokwium audytu')).toHaveCount(0);

  await page.goto('/s');
  await segments(page).getByRole('link', { name: 'All', exact: true }).click();
  await expect(
    page.getByRole('link', { name: /Fizyka techniczna/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Semestr trzeci/ }).first(),
  ).toBeVisible();
});

test('simple: an empty filtered list offers all semesters', async ({
  page,
}) => {
  await page.goto('/semester?to=1&next=/s');
  await expect(page).toHaveURL(/\/s$/);
  // Nothing matches in semester 1.
  await page.goto('/s/search?q=zzzniczegonie');
  await expect(page.getByText('Showing semester 1 only.')).toBeVisible();
  await page.getByRole('link', { name: 'Show all semesters' }).click();
  await expect(page).toHaveURL(/\/s\/search\?q=zzzniczegonie$/);
  await expect(page.getByText('Showing semester 1 only.')).toHaveCount(0);
});

test('advanced: the same switcher filters the home grid, timetable and events', async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: 'studiesdb.mode',
      value: 'advanced',
      domain: 'localhost',
      path: '/',
    },
  ]);
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: 'Fizyka techniczna' }).first(),
  ).toBeVisible();
  await segments(page).getByRole('link', { name: '3', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Semestr trzeci' }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Fizyka techniczna' }),
  ).toHaveCount(0);

  await page.goto('/plan');
  await expect(page.getByText('Fizyka inna')).toHaveCount(0);
  await page.goto('/wydarzenia');
  await expect(page.getByText('Wyjazd trzeciego semestru')).toBeVisible();
  await expect(page.getByText('Kolokwium audytu')).toHaveCount(0);

  await segments(page).getByRole('link', { name: 'All', exact: true }).click();
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: 'Fizyka techniczna' }).first(),
  ).toBeVisible();
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the switcher is a select that navigates on change', async ({
    page,
  }) => {
    await page.goto('/s');
    await expect(segments(page)).toBeHidden();
    const select = page.getByRole('combobox', { name: 'Semester' });
    await expect(select).toBeVisible();
    const box = await select.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await select.selectOption('3');
    await expect(page).toHaveURL(/\/s$/);
    await expect(select).toHaveValue('3');
    await expect(
      page.getByRole('link', { name: /Fizyka techniczna/ }),
    ).toHaveCount(0);
    // No horizontal overflow from the top bar.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // The select may be changed before hydration: retry until it navigates.
    await expect(async () => {
      await select.selectOption('all');
      await expect(
        page.getByRole('link', { name: /Fizyka techniczna/ }).first(),
      ).toBeVisible({ timeout: 3000 });
    }).toPass();
  });
});

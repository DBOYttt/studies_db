import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

// Semester switcher (simple and advanced): fixtures FIZ (semester 1) and
// SEM3 (semester 3, class + group + a session today + an event ahead).
loginOnce('semesters', process.env.E2E_TOKEN_SEMESTERS, { mode: 'simple' });

const segments = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Semester' });

/** `YYYY-Www` of today's Warsaw date: the week the fixtures' sessions are in. */
function thisWeek(): string {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
  })
    .format(new Date())
    .split('-')
    .map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(
    ((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7,
  );
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Timetable session blocks of the opened (current) week, by subject code. */
const blocks = (page: import('@playwright/test').Page, name: string) =>
  page.getByTestId('plan-block').filter({ hasText: name });

/** Clicks a segment (`All` or a number) and waits for the redirect to land. */
async function choose(
  page: import('@playwright/test').Page,
  label: string,
  url: RegExp,
) {
  const name = label === 'All' ? 'All semesters' : `Semester ${label}`;
  await segments(page).getByRole('link', { name, exact: true }).click();
  await expect(page).toHaveURL(url);
}

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

  // Unfiltered: both semesters' sessions are in the current week.
  await page.goto(`/s/plan?week=${thisWeek()}`);
  await expect(blocks(page, 'SEM1')).toHaveCount(1);
  await expect(blocks(page, 'SEM3')).toHaveCount(1);
  await page.goto('/s/wydarzenia');
  await expect(page.getByText('Wyjazd pierwszego semestru')).toBeVisible();
  await page.goto('/s');

  // Segments are at least 24 px (WCAG 2.5.8).
  const seg = await segments(page)
    .getByRole('link', { name: 'Semester 3' })
    .boundingBox();
  expect(seg?.height ?? 0).toBeGreaterThanOrEqual(24);
  expect(seg?.width ?? 0).toBeGreaterThanOrEqual(24);
  await choose(page, '3', /\/s$/);
  await expect(segments(page).locator('[aria-current="true"]')).toHaveText(
    'Semester 3',
  );
  await expect(page).toHaveTitle('Start · Semester 3 · Studies DB');
  await expect(
    page.getByRole('link', { name: /Semestr trzeci/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Fizyka techniczna/ }),
  ).toHaveCount(0);

  // Cookie: the timetable stays filtered without any query parameter.
  await page.goto(`/s/plan?week=${thisWeek()}`);
  await expect(blocks(page, 'SEM3')).toHaveCount(1);
  await expect(blocks(page, 'SEM1')).toHaveCount(0);
  await expect(page.getByText('Filter: Semester 3')).toBeVisible();

  // Events index too.
  await page.goto('/s/wydarzenia');
  await expect(page.getByText('Wyjazd trzeciego semestru')).toBeVisible();
  await expect(page.getByText('Wyjazd pierwszego semestru')).toHaveCount(0);

  await page.goto('/s');
  await choose(page, 'All', /\/s$/);
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
  await expect(page.getByText('Nothing found in semester 1.')).toBeVisible();
  await page.getByRole('link', { name: 'Search all semesters' }).click();
  await expect(page).toHaveURL(/\/s\/search\?q=zzzniczegonie$/);
  await expect(page.getByText('Nothing found in semester 1.')).toHaveCount(0);
  await expect(
    page.getByText('Nothing found. Try another word.'),
  ).toBeVisible();

  // A semester without subjects: no extra segment, a note after them.
  await page.goto('/semester?to=6&next=/s');
  await expect(page).toHaveURL(/\/s$/);
  await expect(page.getByText('No subjects in semester 6.')).toBeVisible();
  await expect(segments(page)).toContainText('Semester 6 (no subjects)');
  await expect(
    segments(page).getByRole('link', { name: 'Semester 6' }),
  ).toHaveCount(0);
  await expect(page).toHaveTitle('Start · Semester 6 · Studies DB');
  await page.getByRole('link', { name: 'Show all semesters' }).click();
  await expect(page).toHaveURL(/\/s$/);
  await expect(page.getByText('No subjects in semester 6.')).toHaveCount(0);
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
  await page.goto(`/plan?week=${thisWeek()}`);
  await expect(blocks(page, 'SEM1')).toHaveCount(1);
  await expect(blocks(page, 'SEM3')).toHaveCount(1);
  await page.goto('/wydarzenia');
  await expect(page.getByText('Wyjazd pierwszego semestru')).toBeVisible();
  await page.goto('/');
  await choose(page, '3', /\/$/);
  await expect(
    page.getByRole('link', { name: 'Semestr trzeci' }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Fizyka techniczna' }),
  ).toHaveCount(0);

  await page.goto(`/plan?week=${thisWeek()}`);
  await expect(blocks(page, 'SEM3')).toHaveCount(1);
  await expect(blocks(page, 'SEM1')).toHaveCount(0);
  await page.goto('/wydarzenia');
  await expect(page.getByText('Wyjazd trzeciego semestru')).toBeVisible();
  await expect(page.getByText('Wyjazd pierwszego semestru')).toHaveCount(0);

  await choose(page, 'All', /\/wydarzenia$/);
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
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    // The select may be changed before hydration (no handler yet): retry.
    await expect(async () => {
      await select.selectOption('3');
      await expect(
        page.getByRole('link', { name: /Fizyka techniczna/ }),
      ).toHaveCount(0, { timeout: 3000 });
    }).toPass();
    await expect(select).toHaveValue('3');
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

test.describe('admin feeds card', () => {
  loginOnce('semesters-admin', process.env.E2E_TOKEN_SEMESTERS_ADMIN);

  test('set, then clear a feed: hints, names, confirmation and result', async ({
    page,
  }) => {
    await page.goto('/admin/sync');
    const card = page.getByRole('region', { name: 'Timetable feeds' });
    await expect(card).toContainText('is a fingerprint of the link');
    const row = card.getByRole('row').filter({ hasText: /^6/ });
    await row.getByRole('button', { name: 'Set semester 6 feed' }).click();
    const form = card.getByRole('form', { name: 'Semester 6 feed' });
    await expect(
      card.getByText('Only https links on plan.agh.edu.pl.'),
    ).toBeVisible();
    await expect(
      card.getByRole('button', { name: 'Close semester 6 feed' }),
    ).toBeVisible();
    // The form may be used before hydration: retry until the save lands.
    await expect(async () => {
      await form
        .getByLabel('Class feed link')
        .fill('https://plan.agh.edu.pl/e2e-semester-6.ics');
      await form.getByRole('button', { name: 'Save feed' }).click();
      await expect(card.getByText('Semester 6 feed saved.')).toBeVisible({
        timeout: 3000,
      });
    }).toPass();
    await expect(row).toContainText(/plan\.agh\.edu\.pl\/…#[0-9a-f]{6}/);
    await expect(
      page.getByText(/Sync requested at \d{2}:\d{2} \(Warsaw\)/),
    ).toBeVisible();

    await row.getByRole('button', { name: 'Clear semester 6 feed' }).click();
    await expect(
      row.getByText(
        'Clear the semester 6 feeds? Its imported sessions are removed at the next successful sync.',
      ),
    ).toBeVisible();
    await row.getByRole('button', { name: 'Confirm clear' }).click();
    await expect(
      card.getByRole('status').filter({ hasText: 'Semester 6 feed cleared.' }),
    ).toBeVisible();
    await expect(row).toContainText('Not set');
  });
});

import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

loginOnce('plan', process.env.E2E_TOKEN_PLAN);

const WEEK = '/plan?week=2026-W42';

test('week view shows blocks with rooms and the session panel', async ({
  page,
}) => {
  await page.goto(WEEK);
  const blocks = page.getByTestId('plan-block');
  await expect(blocks).toHaveCount(4);
  await expect(blocks.filter({ hasText: 'A-1 101' })).toBeVisible();
  await expect(blocks.filter({ hasText: 'B-2 201' })).toBeVisible();

  const panel = page.getByRole('complementary', { name: 'Class details' });
  await expect(async () => {
    await blocks.filter({ hasText: 'A-1 101' }).click();
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(panel.getByText('A-1 101')).toBeVisible();
  await expect(panel.getByText('Piotr Planista')).toBeVisible();
  const lecturer = panel.getByRole('link', { name: 'Lecturer' });
  await expect(lecturer).toHaveAttribute('href', /^\/lecturers\/\d+$/);
});

test('My groups filters groups, persists, and clears', async ({ page }) => {
  // No group saved yet: a prompt says every group is shown.
  await page.goto(WEEK);
  await expect(page.getByText('Showing all groups.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pick yours' })).toHaveAttribute(
    'href',
    '/plan?tab=groups',
  );
  await page.goto('/plan?tab=groups');
  const select = page.getByLabel(/Plan testowy.*Ćwiczenia/);
  await select.selectOption({ label: 'Gr. 2' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await page.goto(WEEK);

  const blocks = page.getByTestId('plan-block');
  await expect(page.getByText('Filter: My groups')).toBeVisible();
  await expect(blocks.filter({ hasText: 'B-2 201' })).toHaveCount(0);
  await expect(blocks.filter({ hasText: 'B-2 202' })).toHaveCount(1);
  // Class-type tag and group label render unchanged (content stays Polish).
  await expect(blocks.filter({ hasText: 'B-2 202' })).toContainText(
    'Ćwiczenia',
  );
  await expect(blocks.filter({ hasText: 'B-2 202' })).toContainText('Gr. 2');
  await expect(blocks.filter({ hasText: 'A-1 101' })).toHaveCount(1);
  // Gr. 1 is hidden on purpose (Gr. 2 is picked): no "pick a group" note.
  await expect(page.getByText(/hidden: pick a group/)).toHaveCount(0);
  await expect(page.getByText('Showing all groups.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'change' })).toHaveAttribute(
    'href',
    '/plan?tab=groups',
  );

  await page.reload();
  await expect(page.getByText('Filter: My groups')).toBeVisible();
  await expect(blocks.filter({ hasText: 'B-2 201' })).toHaveCount(0);

  await page.goto('/plan?tab=groups');
  // The choice lives in the DB: wait for the save to land before leaving.
  const cleared = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/plan'),
  );
  await page.getByRole('button', { name: 'Clear' }).click();
  await cleared;
  await page.goto(WEEK);
  // A block click only works once hydrated, so the checks below see the
  // settled page, not the server HTML.
  const clearedPanel = page.getByRole('complementary', {
    name: 'Class details',
  });
  await expect(async () => {
    await blocks.filter({ hasText: 'B-2 201' }).click();
    await expect(clearedPanel).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.getByText('Filter: My groups')).toHaveCount(0);
  await expect(page.getByText(/hidden: pick a group/)).toHaveCount(0);
  await expect(page.getByText('Showing all groups.')).toBeVisible();
  await expect(blocks).toHaveCount(4);
});

test('list tab is a v_class_sessions grid', async ({ page }) => {
  await page.goto('/plan?tab=list');
  const main = page.getByRole('main');
  await expect(main.getByText('v_class_sessions').first()).toBeVisible();
  await expect(main.getByRole('cell', { name: 'A-1 101' })).toBeVisible();
});

test('subject plan tab shows only that subject', async ({ page }) => {
  await page.goto('/subjects/PLAN?tab=plan&week=2026-W42');
  const blocks = page.getByTestId('plan-block');
  await expect(blocks).toHaveCount(3);
  await expect(blocks.filter({ hasText: 'D-4 404' })).toHaveCount(0);
});

test('lecturer plan tab shows their sessions', async ({ page }) => {
  await page.goto('/tables/v_lecturers');
  const href = await page
    .getByRole('main')
    .getByRole('link', { name: 'Piotr Planista', exact: true })
    .getAttribute('href');
  await page.goto(`${href}?tab=plan&week=2026-W42`);
  const blocks = page.getByTestId('plan-block');
  await expect(blocks).toHaveCount(1);
  await expect(blocks.first()).toContainText('A-1 101');
});

test('Lecturers tab: office hours, room and platform links', async ({
  page,
}) => {
  await page.goto('/subjects/PLAN?tab=lecturers');
  const table = page.getByRole('table', { name: 'Lecturers' });
  await expect(table.getByText('wt. 13:00-14:00')).toBeVisible();
  await expect(table.getByText('C-3 305')).toBeVisible();
  const classes = page.getByRole('table', { name: 'Classes', exact: true });
  await expect(
    classes.getByRole('link', { name: 'Platform ↗' }),
  ).toHaveAttribute('href', 'https://platforma.example.edu/cwiczenia');
  await expect(
    page.getByRole('link', { name: 'UPeL / platform ↗' }),
  ).toHaveAttribute('href', 'https://upel.example.edu/course/plan');
});

test.describe('timetable assessments', () => {
  const ASSESS = '/plan?week=2026-W41';

  test('a Test badge on the lab block and an exam block', async ({ page }) => {
    await page.goto(ASSESS);
    const lab = page.getByTestId('plan-block').filter({ hasText: 'E-5 501' });
    // 90 min with a quiz and a Test: one merged bar that opens the panel.
    const merged = lab.getByRole('button', {
      name: 'Entry quiz: Rozdział 2. Test: Kolokwium z ocen',
    });
    await expect(merged).toBeVisible();
    const labPanel = page.getByRole('complementary', {
      name: 'Class details',
    });
    await expect(async () => {
      await merged.click();
      await expect(labPanel).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(
      labPanel
        .getByRole('list', { name: 'Tests' })
        .getByRole('link', { name: 'Kolokwium z ocen' }),
    ).toHaveAttribute('href', /^\/wydarzenia\/\d+$/);
    await labPanel.getByRole('button', { name: 'Close details' }).click();
    // The kolokwium is a badge, not a separate event block.
    await expect(
      page.getByTestId('plan-event').filter({ hasText: 'Kolokwium z ocen' }),
    ).toHaveCount(0);

    const exam = page.getByTestId('plan-block').filter({ hasText: 'Aula E' });
    await expect(exam).toContainText('Exam');
    await expect(
      page.getByRole('list', { name: 'Class types' }).getByText('Exam'),
    ).toBeVisible();
    // The egzamin event is merged into the exam block, which opens the
    // session panel with a link to the event.
    await expect(
      page.getByTestId('plan-event').filter({ hasText: 'Egzamin z ocen' }),
    ).toHaveCount(0);
    const panel = page.getByRole('complementary', { name: 'Class details' });
    await expect(async () => {
      await exam.locator('[data-block-main]').click();
      await expect(panel).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(
      panel.getByRole('link', { name: 'Open event' }),
    ).toHaveAttribute('href', /^\/wydarzenia\/\d+$/);
  });

  test('"Not this week" removes the entry quiz of that date only', async ({
    page,
  }) => {
    await page.goto(ASSESS);
    const blocks = page.getByTestId('plan-block');
    const g1 = blocks.filter({ hasText: 'E-5 501' });
    const g2 = blocks.filter({ hasText: 'E-5 502' });
    const quiz = g2.getByRole('button', { name: 'Entry quiz: Rozdział 2' });
    await expect(g1.getByRole('button', { name: /^Entry quiz/ })).toBeVisible();

    // The popover of the quiz-only bar on the Gr. 2 block.
    const dialog = page.getByRole('dialog', { name: 'Entry quiz' });
    await expect(async () => {
      await quiz.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(quiz).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByText('Rozdział 2')).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      /^\/subjects\/OCEN\?class=laboratorium&group=2#entry-quiz$/,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(quiz).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');

    // Skip the Gr. 1 date from its panel (its block shows a merged bar).
    const panel = page.getByRole('complementary', { name: 'Class details' });
    await expect(async () => {
      await g1.locator('[data-block-main]').click();
      await expect(panel).toBeVisible({ timeout: 1000 });
    }).toPass();
    await panel
      .getByRole('button', { name: 'Not this week (all groups)' })
      .click();
    await expect(g1.getByRole('button', { name: /^Entry quiz/ })).toHaveCount(
      0,
    );
    await expect(quiz).toBeVisible();
    // The Test badge stays, now as its own bar.
    await expect(
      g1.getByRole('link', { name: 'Test: Kolokwium z ocen' }),
    ).toBeVisible();

    await page.goto('/plan?week=2026-W40');
    await expect(
      blocks
        .filter({ hasText: 'E-5 500' })
        .getByRole('button', { name: /^Entry quiz/ }),
    ).toBeVisible();
  });
});

test('the session panel lists every test and offers "Not this week"', async ({
  page,
}) => {
  await page.goto('/plan?week=2026-W40');
  const block = page.getByTestId('plan-block').filter({ hasText: 'E-5 500' });
  const merged = block.getByRole('button', {
    name: 'Entry quiz: Rozdział 2. 2 tests: Kolokwium A, Kolokwium B',
  });
  await expect(merged).toBeVisible();
  await expect(page.getByTestId('plan-event')).toHaveCount(0);

  const panel = page.getByRole('complementary', { name: 'Class details' });
  // The merged bar opens the panel, which links each test.
  await expect(async () => {
    await merged.click();
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();
  const tests = panel.getByRole('list', { name: 'Tests' });
  await expect(tests.getByRole('link')).toHaveCount(2);
  await expect(
    tests.getByRole('link', { name: 'Kolokwium A' }),
  ).toHaveAttribute('href', /^\/wydarzenia\/\d+$/);
  await expect(tests.getByRole('link', { name: 'Kolokwium B' })).toBeVisible();

  await panel
    .getByRole('button', { name: 'Not this week (all groups)' })
    .click();
  await expect(block.getByRole('button', { name: /^Entry quiz/ })).toHaveCount(
    0,
  );
  // Without the quiz the tests get their own bar again.
  await expect(
    block.getByRole('button', { name: '2 tests: Kolokwium A, Kolokwium B' }),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Not this week (all groups)' }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: 'Undo skip on Tue 29 Sep' }),
  ).toBeVisible();
  await expect(tests.getByRole('link')).toHaveCount(2);
});

test('Tab out of the entry quiz popover closes it', async ({ page }) => {
  await page.goto('/plan?week=2026-W41');
  const g2 = page.getByTestId('plan-block').filter({ hasText: 'E-5 502' });
  const quiz = g2.getByRole('button', { name: /^Entry quiz/ });
  const dialog = page.getByRole('dialog', { name: 'Entry quiz' });
  await expect(async () => {
    await quiz.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(
    dialog.getByRole('button', { name: 'Not this week (all groups)' }),
  ).toBeFocused();
  await page.keyboard.press('Tab'); // Edit
  await page.keyboard.press('Tab'); // out of the dialog
  await expect(dialog).toBeHidden();
  await expect(quiz).toHaveAttribute('aria-expanded', 'false');
  // Focus goes back to the badge, not to the end of the page.
  await expect(quiz).toBeFocused();
});

test('advanced view: "Skip to content" passes the database tree', async ({
  page,
}) => {
  await page.goto(WEEK);
  await expect(page.getByTestId('plan-block').first()).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

test('day columns are named groups and blocks name their day', async ({
  page,
}) => {
  await page.goto(WEEK);
  const tue = page.getByRole('group', { name: 'Tue 13 Oct' });
  await expect(tue.getByTestId('plan-block')).toHaveCount(2);
  await expect(
    page
      .getByRole('group', { name: 'Mon 12 Oct' })
      .getByRole('button', { name: /^Mon 12 Oct, 08:00–09:30 / }),
  ).toBeVisible();
  await expect(
    tue.getByRole('button', { name: /^Tue 13 Oct, 10:00–11:30 / }),
  ).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

// The same admin session as admin.spec.ts (one-time token, shared cookie file).
loginOnce('admin', process.env.E2E_TOKEN_ADMIN);

// Unique names, so no other spec sees these rows (the test DB is reset per run).
const CODE = 'E2EADM';
const SUBJECT = 'Logistyka testowa';
const SUBJECT_EDITED = 'Logistyka testowa II';
const LECTURER = 'Ewelina Zarzecka';
const LECTURER_LABEL = `dr ${LECTURER}`;

test.describe.configure({ mode: 'serial' });

test('admin tabs list Subjects, Lecturers, Users and Sync in order', async ({
  page,
}) => {
  await page.goto('/admin/subjects');
  const names = [
    'Overview',
    'Subjects',
    'Lecturers',
    'Users',
    'Sync',
    'SQL — write',
    'Audit log',
  ];
  const strip = page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link');
  await expect(strip).toHaveText(names);
});

test('add a subject, then edit it', async ({ page }) => {
  await page.goto('/admin/subjects');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Subjects' }),
  ).toBeVisible();
  const add = page.getByRole('region', { name: 'Add subject' });
  await add.getByLabel('Name').fill(SUBJECT);
  await add.getByLabel('Code').fill(CODE.toLowerCase());
  await add.getByLabel('Semester').selectOption('1');
  await add.getByLabel('ECTS').fill('5');
  await add.getByRole('button', { name: 'Add subject' }).click();
  await expect(add.getByRole('status')).toHaveText(
    'Subject added. Run setup on the Sync tab to create its forum.',
  );
  await expect(
    add.getByRole('status').getByRole('link', { name: 'Sync tab' }),
  ).toHaveAttribute('href', '/admin/sync');

  const row = page.getByRole('row').filter({ hasText: CODE });
  await expect(row).toContainText(SUBJECT);
  await expect(row).toContainText('Not created');
  await row.getByRole('link', { name: CODE }).click();
  await expect(page).toHaveURL(`/admin/subjects/${CODE}`);

  const edit = page.getByRole('region', { name: 'Edit subject' });
  await expect(edit.getByLabel('Name')).toHaveValue(SUBJECT);
  await edit.getByLabel('Name').fill(SUBJECT_EDITED);
  await edit.getByLabel('ECTS').fill('6');
  await edit.getByRole('button', { name: 'Save subject' }).click();
  await expect(edit.getByRole('status')).toHaveText(`Updated subject ${CODE}.`);
  await expect(
    page.getByRole('heading', { name: `${CODE} ${SUBJECT_EDITED}` }),
  ).toBeVisible();
  // Saved again with nothing changed.
  await edit.getByRole('button', { name: 'Save subject' }).click();
  await expect(edit.getByRole('status')).toHaveText('No changes.');
});

test('a subject URL resolves case-insensitively after trim; unknown is 404', async ({
  page,
}) => {
  await page.goto(`/admin/subjects/%20${CODE.toLowerCase()}`);
  await expect(
    page.getByRole('heading', { name: `${CODE} ${SUBJECT_EDITED}` }),
  ).toBeVisible();
  const res = await page.goto('/admin/subjects/NO-SUCH-E2E');
  expect(res?.status()).toBe(404);
  const res2 = await page.goto('/admin/lecturers/999999');
  expect(res2?.status()).toBe(404);
  const res3 = await page.goto('/admin/lecturers/abc');
  expect(res3?.status()).toBe(404);
});

test('a refused add shows the error and keeps the input', async ({ page }) => {
  await page.goto('/admin/subjects');
  const add = page.getByRole('region', { name: 'Add subject' });
  await add.getByLabel('Name').fill('Druga logistyka');
  await add.getByLabel('Code').fill(CODE);
  await add.getByLabel('Semester').selectOption('2');
  await add.getByLabel('ECTS').fill('3');
  await add.getByRole('button', { name: 'Add subject' }).click();
  await expect(add.getByRole('alert')).toHaveText(
    'A subject with this code or channel already exists.',
  );
  await expect(add.getByLabel('Name')).toHaveValue('Druga logistyka');
});

test('add a lecturer, assign them, edit the class and the lecturer', async ({
  page,
}) => {
  await page.goto('/admin/lecturers');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Lecturers' }),
  ).toBeVisible();
  const add = page.getByRole('region', { name: 'Add lecturer' });
  await add.getByLabel('Name').fill(LECTURER);
  await add.getByLabel('Title').fill('dr');
  await add.getByLabel('Email').fill('E2EADM@example.com');
  await add.getByRole('button', { name: 'Add lecturer' }).click();
  await expect(add.getByRole('status')).toHaveText(
    new RegExp(`^Added lecturer ${LECTURER_LABEL} \\(id \\d+\\)\\.$`),
  );
  // The form is cleared for the next one.
  await expect(add.getByLabel('Name')).toHaveValue('');
  const row = page.getByRole('row').filter({ hasText: LECTURER });
  await expect(row).toContainText('e2eadm@example.com');

  await page.goto(`/admin/subjects/${CODE}`);
  await expect(page.getByText('No classes yet.')).toBeVisible();
  const assign = page.getByRole('region', { name: 'Assign a lecturer' });
  await assign
    .locator('select[name="lecturerId"]')
    .selectOption({ label: LECTURER_LABEL });
  await assign.getByLabel('Class type').selectOption({ label: 'Wykład' });
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(assign.getByRole('status')).toHaveText(
    `Assigned the lecturer to ${CODE} / Wykład.`,
  );

  const card = page.getByRole('region', { name: 'Wykład', exact: true });
  const settings = card.getByRole('form', { name: 'Wykład settings' });
  const assignHere = card.getByRole('form', {
    name: 'Assign a lecturer to Wykład',
  });
  await expect(card.getByRole('list', { name: 'Lecturers' })).toContainText(
    LECTURER_LABEL,
  );
  // Per-class assign, to one group.
  await assignHere
    .locator('select[name="lecturerId"]')
    .selectOption({ label: LECTURER_LABEL });
  await assignHere.getByLabel('Group').fill('2');
  await assignHere.getByRole('button', { name: 'Assign' }).click();
  await expect(assignHere.getByRole('status')).toHaveText(
    `Assigned the lecturer to ${CODE} / Wykład, Gr. 2.`,
  );
  await expect(card.getByRole('list', { name: 'Lecturers' })).toContainText(
    'Gr. 2',
  );

  await settings.getByLabel('Assessment').selectOption({ label: 'Exam' });
  await settings.getByLabel('Note').fill('Pisemny, 90 minut');
  await settings.getByRole('button', { name: 'Save class' }).click();
  await expect(settings.getByRole('status')).toHaveText(
    `Updated ${CODE} / Wykład.`,
  );
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Wykład', exact: true })
      .getByLabel('Note'),
  ).toHaveValue('Pisemny, 90 minut');

  await page.goto('/admin/lecturers');
  await page
    .getByRole('row')
    .filter({ hasText: LECTURER })
    .getByRole('link', { name: LECTURER })
    .click();
  await expect(page).toHaveURL(/\/admin\/lecturers\/\d+$/);
  const edit = page.getByRole('region', { name: 'Edit lecturer' });
  await expect(edit.getByLabel('Email')).toHaveValue('e2eadm@example.com');
  await edit.getByLabel('Room').fill('D-10 105');
  await edit.getByRole('button', { name: 'Save lecturer' }).click();
  await expect(edit.getByRole('status')).toHaveText(
    `Updated lecturer ${LECTURER_LABEL}.`,
  );
  await expect(edit.getByLabel('Room')).toHaveValue('D-10 105');
});

test('the audit log has a row for each change, from the website', async ({
  page,
}) => {
  // This spec's lecturer id, from its link on the Lecturers tab.
  await page.goto('/admin/lecturers');
  const href = await page
    .getByRole('row')
    .filter({ hasText: LECTURER })
    .getByRole('link', { name: LECTURER })
    .getAttribute('href');
  const lecturerId = href?.match(/(\d+)$/)?.[1] ?? '';
  expect(lecturerId).not.toBe('');

  await page.goto('/admin/audit');
  const table = page.getByRole('table');
  const rows = (label: string) =>
    table.getByRole('row').filter({ hasText: label });
  // Subject actions: target is this spec's code (a link to the subject).
  const bySubject = (label: string) =>
    rows(label).filter({
      has: page.getByRole('link', { name: CODE, exact: true }),
    });
  // Lecturer actions: target is this spec's lecturer id, as stored.
  const byLecturer = (label: string) =>
    rows(label).filter({
      has: page.getByRole('cell', { name: lecturerId, exact: true }),
    });
  const expected: [ReturnType<typeof rows>, number][] = [
    [bySubject('Subject added'), 1],
    [bySubject('Subject changed'), 1],
    [bySubject('Lecturer assigned'), 2],
    [bySubject('Class changed'), 1],
    [byLecturer('Lecturer added'), 1],
    [byLecturer('Lecturer changed'), 1],
  ];
  for (const [found, n] of expected) {
    await expect(found).toHaveCount(n);
    for (let i = 0; i < n; i++) {
      await expect(found.nth(i)).toContainText('Adam Administrator');
      await expect(found.nth(i)).toContainText('via the website');
    }
  }
});

test('form controls carry the field limits', async ({ page }) => {
  await page.goto('/admin/subjects');
  const add = page.getByRole('region', { name: 'Add subject' });
  await expect(add.getByLabel('Name')).toHaveAttribute('maxlength', '200');
  await expect(add.getByLabel('Code')).toHaveAttribute('maxlength', '20');
  await expect(add.getByLabel('Description')).toHaveAttribute(
    'maxlength',
    '1000',
  );
});

test('block and unblock a user, behind a confirm', async ({ page }) => {
  await page.goto('/admin/users?q=Blokowany');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Users' }),
  ).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Bartek Blokowany' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('e2e-blockable');
  await expect(row).toContainText('Active');

  // The first click only asks; Cancel backs out.
  await row.getByRole('button', { name: 'Block', exact: true }).click();
  const ask = row.getByRole('group', { name: /^Block Bartek Blokowany\?/ });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  await expect(row).toContainText('Active');

  await row.getByRole('button', { name: 'Block', exact: true }).click();
  await row.getByRole('button', { name: 'Confirm block' }).click();
  await expect(row.getByRole('status')).toHaveText(
    'Blocked access to the website.',
  );
  await expect(row).toContainText('Blocked');

  await row.getByRole('button', { name: 'Unblock', exact: true }).click();
  await row.getByRole('button', { name: 'Confirm unblock' }).click();
  await expect(row.getByRole('status')).toHaveText(
    'Unblocked access to the website.',
  );
  await expect(row).toContainText('Active');

  // The admin's own row has no block button.
  await page.goto('/admin/users?q=e2e-admin');
  const self = page.getByRole('row').filter({ hasText: 'Adam Administrator' });
  await expect(self).toContainText('This is you');
  await expect(self.getByRole('button')).toHaveCount(0);
});

test('queue a setup preview, see it queued, cancel it', async ({ page }) => {
  await page.goto('/admin/sync');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sync' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sync timetable' }),
  ).toBeVisible();
  const bot = page.getByRole('region', { name: 'Discord server' });
  await bot.getByRole('button', { name: 'Preview changes' }).click();
  await expect(bot.getByRole('status').filter({ hasText: /\S/ })).toHaveText(
    'Request queued. The bot will pick it up within a few seconds.',
  );
  const requests = page.getByRole('region', { name: 'Bot requests' });
  const row = requests
    .getByRole('row')
    .filter({ hasText: 'Setup preview' })
    .first();
  await expect(row).toContainText('queued');
  await expect(row).toContainText('Adam Administrator');
  await expect(row).toContainText(/\d{2}:\d{2}:\d{2} CES?T/);
  // While it waits, new requests are off.
  await expect(bot.getByRole('button', { name: 'Run setup' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  await row.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toContainText('failed');
  await expect(row).toContainText('Cancelled.');
  await expect(
    bot.getByRole('button', { name: 'Run setup' }),
  ).not.toHaveAttribute('aria-disabled', 'true');

  await page.goto('/admin/audit?action=bot.request');
  const audit = page.getByRole('table').getByRole('row').filter({
    hasText: 'Bot request queued',
  });
  await expect(audit.first()).toContainText('Adam Administrator');
  await page.goto('/admin/audit?action=bot.request_cancel');
  await expect(
    page
      .getByRole('table')
      .getByRole('row')
      .filter({ hasText: 'Bot request cancelled' })
      .first(),
  ).toBeVisible();
});

test.describe('a student', () => {
  loginOnce('nonadmin', process.env.E2E_TOKEN_NONADMIN, { mode: 'simple' });

  test('gets 404 on every new admin page', async ({ page }) => {
    for (const path of [
      '/admin/subjects',
      `/admin/subjects/${CODE}`,
      '/admin/lecturers',
      '/admin/users',
      '/admin/sync',
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });
});

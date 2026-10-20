import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

// A student (simple view) manages an event; an admin restores it.
loginOnce('events', process.env.E2E_TOKEN_EVENTS, { mode: 'simple' });
test.describe.configure({ mode: 'serial' });

let eventUrl = '';
// The admin's login token is single use: its cookies are kept for later tests.
let adminCookies: import('@playwright/test').Cookie[] = [];

function dateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test('add an event; its page says the Discord post is being prepared', async ({
  page,
}) => {
  await page.goto('/s/wydarzenia/nowe');
  await page.getByLabel('Type').selectOption('kolokwium');
  await page.getByLabel('Title', { exact: true }).fill('Kolokwium z tarcia');
  await page.getByLabel('Date').fill(dateIn(7));
  await page.getByLabel('From (time)').fill('10:00');
  await page.getByLabel('To (time)').fill('11:30');
  await page
    .getByRole('combobox', { name: 'Subject' })
    .selectOption({ label: 'FIZ · Fizyka techniczna' });
  await page.getByLabel('Place').fill('C-12');
  await page.getByRole('button', { name: 'Add event' }).click();

  await expect(page).toHaveURL(/\/s\/wydarzenia\/\d+$/);
  eventUrl = new URL(page.url()).pathname;
  await expect(
    page.getByRole('heading', { name: 'Kolokwium z tarcia' }),
  ).toBeVisible();
  await expect(page.getByText('Discord post: being prepared')).toBeVisible();
  await expect(page.getByText('C-12')).toBeVisible();
  await expect(page.getByText('Event added')).toBeVisible();
});

function isoWeekParam(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - jan4.getTime()) / 86_400_000 -
        3 +
        ((jan4.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${year}-W${String(week).padStart(2, '0')}`;
}

test('the event shows in the plan week and on the start page', async ({
  page,
}) => {
  await page.goto(`/s/plan?week=${isoWeekParam(dateIn(7))}`);
  const block = page
    .getByTestId('plan-event')
    .filter({ hasText: 'Kolokwium z tarcia' });
  await expect(block).toBeVisible();
  await expect(page.getByRole('link', { name: /Add event$/ })).toHaveAttribute(
    'href',
    /^\/s\/wydarzenia\/nowe\?date=\d{4}-\d{2}-\d{2}/,
  );

  await page.goto('/s');
  const card = page.getByRole('region', { name: 'Upcoming events' });
  await expect(card.getByText('Kolokwium z tarcia')).toBeVisible();
  await card.getByRole('link', { name: /Kolokwium z tarcia/ }).click();
  await expect(page).toHaveURL(/\/s\/wydarzenia\/\d+$/);
});

test('an invalid form shows the English message', async ({ page }) => {
  await page.goto('/s/wydarzenia/nowe');
  await page.getByLabel('Title', { exact: true }).fill('Coś');
  await page.getByLabel('Date').fill('2001-01-01');
  await page.getByRole('button', { name: 'Add event' }).click();
  await expect(
    page.getByText('The date cannot be more than a month in the past.'),
  ).toBeVisible();
});

test('a refused save keeps the typed values', async ({ page }) => {
  await page.goto('/s/wydarzenia/nowe');
  await page.getByLabel('Title', { exact: true }).fill('Zachowaj mnie');
  await page.getByLabel('Date').fill('2001-01-01');
  await page.getByLabel('Place').fill('B-7');
  await page
    .getByRole('combobox', { name: 'Subject' })
    .selectOption({ label: 'FIZ · Fizyka techniczna' });
  await page.getByRole('button', { name: 'Add event' }).click();
  await expect(
    page.getByText('The date cannot be more than a month in the past.'),
  ).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Zachowaj mnie',
  );
  await expect(page.getByLabel('Date')).toHaveValue('2001-01-01');
  await expect(page.getByLabel('Place')).toHaveValue('B-7');
  await expect(page.getByRole('combobox', { name: 'Subject' })).toHaveValue(
    /\d+/,
  );
});

test('edit the title', async ({ page }) => {
  await page.goto(eventUrl);
  await page.getByRole('link', { name: 'Edit' }).click();
  await page
    .getByLabel('Title', { exact: true })
    .fill('Kolokwium z tarcia (poprawione)');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(eventUrl);
  await expect(
    page.getByRole('heading', { name: 'Kolokwium z tarcia (poprawione)' }),
  ).toBeVisible();
  await expect(page.getByText('Event changed')).toBeVisible();
});

test('link a seeded post; its files appear under Materials', async ({
  page,
}) => {
  await page.goto(eventUrl);
  await expect(page.getByText('No materials')).toBeVisible();
  await page.getByLabel('Search posts by title').fill('tarcie');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: /Link post Kolokwium 1/ }).click();
  await expect(page.getByText('sample.pdf')).toBeVisible();
  await expect(page.getByText('notatki.docx')).toBeVisible();
  await page.getByRole('button', { name: /Unlink post Kolokwium 1/ }).click();
  await expect(page.getByText('No materials')).toBeVisible();
});

test('uploading a file shows it as sending… (no bot in e2e)', async ({
  page,
}) => {
  await page.goto(eventUrl);
  await page.getByLabel('Files to add').setInputFiles({
    name: 'notatki.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await page.getByRole('button', { name: 'Add files' }).click();
  await expect(page.getByText('notatki.txt')).toBeVisible();
  await expect(page.getByText('sending…')).toBeVisible();
  // Survives a reload: the status comes from the DB.
  await page.reload();
  await expect(page.getByText('notatki.txt')).toBeVisible();
  await expect(page.getByText('sending…')).toBeVisible();
});

test('a large upload (2 x 7.5 MB) succeeds', async ({ page }) => {
  await page.goto(eventUrl);
  const big = (name: string) => ({
    name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(7.5 * 1024 * 1024, 1),
  });
  await page
    .getByLabel('Files to add')
    .setInputFiles([big('duzy1.bin'), big('duzy2.bin')]);
  await page.getByRole('button', { name: 'Add files' }).click();
  await expect(page.getByText('duzy1.bin')).toBeVisible();
  await expect(page.getByText('duzy2.bin')).toBeVisible();
  await expect(page.getByText(/Could not|too large|Invalid/)).toHaveCount(0);
});

test('delete the event; an admin sees it with Restore', async ({
  page,
  browser,
}) => {
  await page.goto(eventUrl);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(page).toHaveURL(/\/s\/plan$/);

  // gone for the student
  const gone = await page.goto(eventUrl);
  expect(gone?.status()).toBe(404);

  // visible to an admin (advanced view), who can restore it
  const admin = await browser.newContext({ locale: 'pl-PL' });
  try {
    const p = await admin.newPage();
    await p.goto(
      `http://localhost:3100/auth/callback?token=${process.env.E2E_TOKEN_EVENTS_ADMIN}`,
    );
    await p.getByRole('button', { name: 'Sign in' }).click();
    await expect(p).toHaveURL(/localhost:3100\/s$/);
    adminCookies = await admin.cookies();
    await p.goto(`http://localhost:3100${eventUrl.replace('/s', '')}`);
    await expect(
      p.getByText('This event was deleted', { exact: true }),
    ).toBeVisible();
    await p.getByRole('button', { name: 'Restore' }).click();
    await expect(
      p.getByText('This event was deleted', { exact: true }),
    ).toBeHidden();
    await expect(p.getByText('Event restored')).toBeVisible();
  } finally {
    await admin.close();
  }
});

test.describe('recurring event', () => {
  const title = 'Konsultacje cykliczne';
  const block = (page: import('@playwright/test').Page) =>
    page.getByTestId('plan-event').filter({ hasText: title });

  test('a weekly event appears in 3 consecutive weeks', async ({ page }) => {
    await page.goto('/s/wydarzenia/nowe');
    await page.getByLabel('Type').selectOption('zajecia_dodatkowe');
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Date').fill(dateIn(7));
    await page.getByLabel('From (time)').fill('12:00');
    await page.getByLabel('To (time)').fill('13:00');
    await page.getByLabel('Repeat').selectOption('weekly');
    await page.getByLabel('Until', { exact: true }).fill(dateIn(21));
    await page.getByRole('button', { name: 'Add event' }).click();
    await expect(page).toHaveURL(/\/s\/wydarzenia\/\d+$/);
    await expect(page.getByText('Part of a series')).toBeVisible();
    for (const days of [7, 14, 21]) {
      await page.goto(`/s/plan?week=${isoWeekParam(dateIn(days))}`);
      await expect(block(page)).toHaveCount(1);
    }
  });

  test('delete "This and following" from week 2 leaves week 1', async ({
    page,
  }) => {
    await page.goto(`/s/plan?week=${isoWeekParam(dateIn(14))}`);
    await block(page).click();
    await expect(page).toHaveURL(/\/s\/wydarzenia\/\d+$/);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'This and following' }).click();
    await expect(page).toHaveURL(/\/s\/plan$/);
    await page.goto(`/s/plan?week=${isoWeekParam(dateIn(7))}`);
    await expect(block(page)).toHaveCount(1);
    for (const days of [14, 21]) {
      await page.goto(`/s/plan?week=${isoWeekParam(dateIn(days))}`);
      await expect(block(page)).toHaveCount(0);
    }
  });
});

test.describe('concurrent edits', () => {
  async function addEvent(page: import('@playwright/test').Page, t: string) {
    await page.goto('/s/wydarzenia/nowe');
    await page.getByLabel('Title', { exact: true }).fill(t);
    await page.getByLabel('Date').fill(dateIn(9));
    await page.getByRole('button', { name: 'Add event' }).click();
    await expect(page).toHaveURL(/\/s\/wydarzenia\/\d+$/);
    return new URL(page.url()).pathname;
  }
  // A second browser context logged in as the same student.
  async function otherTab(
    page: import('@playwright/test').Page,
    browser: import('@playwright/test').Browser,
  ) {
    const ctx = await browser.newContext({ locale: 'pl-PL' });
    await ctx.addCookies(await page.context().cookies());
    return { ctx, page: await ctx.newPage() };
  }

  test('editing a deleted event shows the banner', async ({
    page,
    browser,
  }) => {
    const url = await addEvent(page, 'Do usunięcia w trakcie');
    await page.goto(`${url}/edytuj`);
    await page.getByLabel('Title', { exact: true }).waitFor();
    const b = await otherTab(page, browser);
    try {
      await b.page.goto(url);
      await b.page.getByRole('button', { name: 'Delete', exact: true }).click();
      await b.page.getByRole('button', { name: 'Yes, delete' }).click();
      await expect(b.page).toHaveURL(/\/s\/plan$/);
    } finally {
      await b.ctx.close();
    }
    await page
      .getByLabel('Title', { exact: true })
      .fill('Nowy tytuł po usunięciu');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText("This event was deleted. Your changes weren't saved."),
    ).toBeVisible();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
      'Nowy tytuł po usunięciu',
    );
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(
      page.getByRole('link', { name: 'Back to timetable' }),
    ).toBeVisible();
  });

  test('an admin restores from the banner, then saves', async ({
    page,
    browser,
  }) => {
    const url = await addEvent(page, 'Przywróć i zapisz');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page).toHaveURL(/\/s\/plan$/);
    const admin = await browser.newContext({ locale: 'pl-PL' });
    try {
      const p = await admin.newPage();
      await admin.addCookies(adminCookies);
      await p.goto(`http://localhost:3100${url.replace('/s', '')}/edytuj`);
      await expect(
        p.getByText("This event was deleted. Your changes weren't saved."),
      ).toBeVisible();
      await p
        .getByLabel('Title', { exact: true })
        .fill('Przywrócone i zmienione');
      await p.getByRole('button', { name: 'Restore' }).click();
      await expect(p.getByRole('button', { name: 'Restore' })).toBeHidden();
      await expect(p.getByLabel('Title', { exact: true })).toHaveValue(
        'Przywrócone i zmienione',
      );
      await p.getByRole('button', { name: 'Save' }).click();
      await expect(p).toHaveURL(/\/wydarzenia\/\d+$/);
      await expect(
        p.getByRole('heading', { name: 'Przywrócone i zmienione' }),
      ).toBeVisible();
    } finally {
      await admin.close();
    }
  });

  test('an edit hidden behind a delete is not overwritten after a restore', async ({
    page,
    browser,
  }) => {
    const url = await addEvent(page, 'Ukryta zmiana');
    const admin = await browser.newContext({ locale: 'pl-PL' });
    try {
      const p = await admin.newPage();
      await admin.addCookies(adminCookies);
      await p.goto(`http://localhost:3100${url.replace('/s', '')}/edytuj`);
      await p.getByLabel('Title', { exact: true }).waitFor();
      // The student edits, then deletes, while the admin's form is open.
      await page.goto(`${url}/edytuj`);
      await page.getByLabel('Title', { exact: true }).fill('Zmiana studenta');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page).toHaveURL(url);
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByRole('button', { name: 'Yes, delete' }).click();
      await expect(page).toHaveURL(/\/s\/plan$/);
      await p.getByLabel('Title', { exact: true }).fill('Zmiana admina');
      await p.getByRole('button', { name: 'Save' }).click();
      await p.getByRole('button', { name: 'Restore' }).click();
      await expect(p.getByRole('button', { name: 'Restore' })).toBeHidden();
      await p.getByRole('button', { name: 'Save' }).click();
      await expect(p.getByText('Someone changed this event')).toBeVisible();
      await page.goto(url);
      await expect(
        page.getByRole('heading', { name: 'Zmiana studenta' }),
      ).toBeVisible();
    } finally {
      await admin.close();
    }
  });

  test('two tabs editing one event', async ({ page, browser }) => {
    const url = await addEvent(page, 'Dwie karty');
    await page.goto(`${url}/edytuj`);
    await page.getByLabel('Title', { exact: true }).waitFor();
    const b = await otherTab(page, browser);
    try {
      await b.page.goto(`${url}/edytuj`);
      await b.page
        .getByLabel('Title', { exact: true })
        .fill('Zmiana z karty B');
      await b.page.getByRole('button', { name: 'Save' }).click();
      await expect(b.page).toHaveURL(url);
    } finally {
      await b.ctx.close();
    }
    await page.getByLabel('Title', { exact: true }).fill('Zmiana z karty A');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Someone changed this event')).toBeVisible();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
      'Zmiana z karty A',
    );
  });
});

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
  await page.getByLabel('Rodzaj').selectOption('kolokwium');
  await page.getByLabel('Tytuł').fill('Kolokwium z tarcia');
  await page.getByLabel('Data').fill(dateIn(7));
  await page.getByLabel('Od (godz.)').fill('10:00');
  await page.getByLabel('Do (godz.)').fill('11:30');
  await page
    .getByRole('combobox', { name: 'Przedmiot' })
    .selectOption({ label: 'FIZ · Fizyka techniczna' });
  await page.getByLabel('Miejsce').fill('C-12');
  await page.getByRole('button', { name: 'Dodaj wydarzenie' }).click();

  await expect(page).toHaveURL(/\/s\/wydarzenia\/\d+$/);
  eventUrl = new URL(page.url()).pathname;
  await expect(
    page.getByRole('heading', { name: 'Kolokwium z tarcia' }),
  ).toBeVisible();
  await expect(
    page.getByText('Post na Discordzie: w przygotowaniu'),
  ).toBeVisible();
  await expect(page.getByText('C-12')).toBeVisible();
  await expect(page.getByText('Dodano wydarzenie')).toBeVisible();
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
  await expect(page.getByRole('link', { name: /Wydarzenie$/ })).toHaveAttribute(
    'href',
    /^\/s\/wydarzenia\/nowe\?date=\d{4}-\d{2}-\d{2}/,
  );

  await page.goto('/s');
  const card = page.getByRole('region', { name: 'Nadchodzące wydarzenia' });
  await expect(card.getByText('Kolokwium z tarcia')).toBeVisible();
  await card.getByRole('link', { name: /Kolokwium z tarcia/ }).click();
  await expect(page).toHaveURL(/\/s\/wydarzenia\/\d+$/);
});

test('an invalid form shows the Polish message', async ({ page }) => {
  await page.goto('/s/wydarzenia/nowe');
  await page.getByLabel('Tytuł').fill('Coś');
  await page.getByLabel('Data').fill('2001-01-01');
  await page.getByRole('button', { name: 'Dodaj wydarzenie' }).click();
  await expect(
    page.getByText('Data nie może być więcej niż miesiąc wstecz.'),
  ).toBeVisible();
});

test('a refused save keeps the typed values', async ({ page }) => {
  await page.goto('/s/wydarzenia/nowe');
  await page.getByLabel('Tytuł').fill('Zachowaj mnie');
  await page.getByLabel('Data').fill('2001-01-01');
  await page.getByLabel('Miejsce').fill('B-7');
  await page
    .getByRole('combobox', { name: 'Przedmiot' })
    .selectOption({ label: 'FIZ · Fizyka techniczna' });
  await page.getByRole('button', { name: 'Dodaj wydarzenie' }).click();
  await expect(
    page.getByText('Data nie może być więcej niż miesiąc wstecz.'),
  ).toBeVisible();
  await expect(page.getByLabel('Tytuł')).toHaveValue('Zachowaj mnie');
  await expect(page.getByLabel('Data')).toHaveValue('2001-01-01');
  await expect(page.getByLabel('Miejsce')).toHaveValue('B-7');
  await expect(page.getByRole('combobox', { name: 'Przedmiot' })).toHaveValue(
    /\d+/,
  );
});

test('edit the title', async ({ page }) => {
  await page.goto(eventUrl);
  await page.getByRole('link', { name: 'Edytuj' }).click();
  await page.getByLabel('Tytuł').fill('Kolokwium z tarcia (poprawione)');
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page).toHaveURL(eventUrl);
  await expect(
    page.getByRole('heading', { name: 'Kolokwium z tarcia (poprawione)' }),
  ).toBeVisible();
  await expect(page.getByText('Zmieniono wydarzenie')).toBeVisible();
});

test('link a seeded post; its files appear under Materiały', async ({
  page,
}) => {
  await page.goto(eventUrl);
  await expect(page.getByText('Brak materiałów')).toBeVisible();
  await page.getByLabel('Szukaj posta po tytule').fill('tarcie');
  await page.getByRole('button', { name: 'Szukaj' }).click();
  await page.getByRole('button', { name: /Powiąż post Kolokwium 1/ }).click();
  await expect(page.getByText('sample.pdf')).toBeVisible();
  await expect(page.getByText('notatki.docx')).toBeVisible();
  await page
    .getByRole('button', { name: /Usuń powiązanie z postem Kolokwium 1/ })
    .click();
  await expect(page.getByText('Brak materiałów')).toBeVisible();
});

test('uploading a file shows it as wysyłanie… (no bot in e2e)', async ({
  page,
}) => {
  await page.goto(eventUrl);
  await page.getByLabel('Pliki do dodania').setInputFiles({
    name: 'notatki.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await page.getByRole('button', { name: 'Dodaj pliki' }).click();
  await expect(page.getByText('notatki.txt')).toBeVisible();
  await expect(page.getByText('wysyłanie…')).toBeVisible();
  // Survives a reload: the status comes from the DB.
  await page.reload();
  await expect(page.getByText('notatki.txt')).toBeVisible();
  await expect(page.getByText('wysyłanie…')).toBeVisible();
});

test('a large upload (2 x 7.5 MB) succeeds', async ({ page }) => {
  await page.goto(eventUrl);
  const big = (name: string) => ({
    name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(7.5 * 1024 * 1024, 1),
  });
  await page
    .getByLabel('Pliki do dodania')
    .setInputFiles([big('duzy1.bin'), big('duzy2.bin')]);
  await page.getByRole('button', { name: 'Dodaj pliki' }).click();
  await expect(page.getByText('duzy1.bin')).toBeVisible();
  await expect(page.getByText('duzy2.bin')).toBeVisible();
  await expect(page.getByText(/Nie udało|za duży|Nieprawidłowe/)).toHaveCount(
    0,
  );
});

test('delete the event; an admin sees it with Przywróć', async ({
  page,
  browser,
}) => {
  await page.goto(eventUrl);
  await page.getByRole('button', { name: 'Usuń', exact: true }).click();
  await page.getByRole('button', { name: 'Tak, usuń' }).click();
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
    await p.getByRole('button', { name: 'Zaloguj się' }).click();
    await expect(p).toHaveURL(/localhost:3100\/s$/);
    adminCookies = await admin.cookies();
    await p.goto(`http://localhost:3100${eventUrl.replace('/s', '')}`);
    await expect(p.getByText('Wydarzenie usunięte')).toBeVisible();
    await p.getByRole('button', { name: 'Przywróć' }).click();
    await expect(p.getByText('Wydarzenie usunięte')).toBeHidden();
    await expect(p.getByText('Przywrócono wydarzenie')).toBeVisible();
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
    await page.getByLabel('Rodzaj').selectOption('zajecia_dodatkowe');
    await page.getByLabel('Tytuł').fill(title);
    await page.getByLabel('Data').fill(dateIn(7));
    await page.getByLabel('Od (godz.)').fill('12:00');
    await page.getByLabel('Do (godz.)').fill('13:00');
    await page.getByLabel('Powtarzaj').selectOption('weekly');
    await page.getByLabel('do', { exact: true }).fill(dateIn(21));
    await page.getByRole('button', { name: 'Dodaj wydarzenie' }).click();
    await expect(page).toHaveURL(/\/s\/wydarzenia\/\d+$/);
    await expect(page.getByText('Część serii')).toBeVisible();
    for (const days of [7, 14, 21]) {
      await page.goto(`/s/plan?week=${isoWeekParam(dateIn(days))}`);
      await expect(block(page)).toHaveCount(1);
    }
  });

  test('delete "To i następne" from week 2 leaves week 1', async ({ page }) => {
    await page.goto(`/s/plan?week=${isoWeekParam(dateIn(14))}`);
    await block(page).click();
    await expect(page).toHaveURL(/\/s\/wydarzenia\/\d+$/);
    await page.getByRole('button', { name: 'Usuń', exact: true }).click();
    await page.getByRole('button', { name: 'To i następne' }).click();
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
    await page.getByLabel('Tytuł').fill(t);
    await page.getByLabel('Data').fill(dateIn(9));
    await page.getByRole('button', { name: 'Dodaj wydarzenie' }).click();
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
    await page.getByLabel('Tytuł').waitFor();
    const b = await otherTab(page, browser);
    try {
      await b.page.goto(url);
      await b.page.getByRole('button', { name: 'Usuń', exact: true }).click();
      await b.page.getByRole('button', { name: 'Tak, usuń' }).click();
      await expect(b.page).toHaveURL(/\/s\/plan$/);
    } finally {
      await b.ctx.close();
    }
    await page.getByLabel('Tytuł').fill('Nowy tytuł po usunięciu');
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await expect(
      page.getByText("This event was deleted. Your changes weren't saved."),
    ).toBeVisible();
    await expect(page.getByLabel('Tytuł')).toHaveValue(
      'Nowy tytuł po usunięciu',
    );
    await expect(page.getByRole('button', { name: 'Zapisz' })).toBeDisabled();
    await expect(
      page.getByRole('link', { name: 'Back to plan' }),
    ).toBeVisible();
  });

  test('an admin restores from the banner, then saves', async ({
    page,
    browser,
  }) => {
    const url = await addEvent(page, 'Przywróć i zapisz');
    await page.getByRole('button', { name: 'Usuń', exact: true }).click();
    await page.getByRole('button', { name: 'Tak, usuń' }).click();
    await expect(page).toHaveURL(/\/s\/plan$/);
    const admin = await browser.newContext({ locale: 'pl-PL' });
    try {
      const p = await admin.newPage();
      await admin.addCookies(adminCookies);
      await p.goto(`http://localhost:3100${url.replace('/s', '')}/edytuj`);
      await expect(
        p.getByText("This event was deleted. Your changes weren't saved."),
      ).toBeVisible();
      await p.getByLabel('Tytuł').fill('Przywrócone i zmienione');
      await p.getByRole('button', { name: 'Restore' }).click();
      await expect(p.getByRole('button', { name: 'Restore' })).toBeHidden();
      await expect(p.getByLabel('Tytuł')).toHaveValue(
        'Przywrócone i zmienione',
      );
      await p.getByRole('button', { name: 'Zapisz' }).click();
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
      await p.getByLabel('Tytuł').waitFor();
      // The student edits, then deletes, while the admin's form is open.
      await page.goto(`${url}/edytuj`);
      await page.getByLabel('Tytuł').fill('Zmiana studenta');
      await page.getByRole('button', { name: 'Zapisz' }).click();
      await expect(page).toHaveURL(url);
      await page.getByRole('button', { name: 'Usuń', exact: true }).click();
      await page.getByRole('button', { name: 'Tak, usuń' }).click();
      await expect(page).toHaveURL(/\/s\/plan$/);
      await p.getByLabel('Tytuł').fill('Zmiana admina');
      await p.getByRole('button', { name: 'Zapisz' }).click();
      await p.getByRole('button', { name: 'Restore' }).click();
      await expect(p.getByRole('button', { name: 'Restore' })).toBeHidden();
      await p.getByRole('button', { name: 'Zapisz' }).click();
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
    await page.getByLabel('Tytuł').waitFor();
    const b = await otherTab(page, browser);
    try {
      await b.page.goto(`${url}/edytuj`);
      await b.page.getByLabel('Tytuł').fill('Zmiana z karty B');
      await b.page.getByRole('button', { name: 'Zapisz' }).click();
      await expect(b.page).toHaveURL(url);
    } finally {
      await b.ctx.close();
    }
    await page.getByLabel('Tytuł').fill('Zmiana z karty A');
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByText('Someone changed this event')).toBeVisible();
    await expect(page.getByLabel('Tytuł')).toHaveValue('Zmiana z karty A');
  });
});

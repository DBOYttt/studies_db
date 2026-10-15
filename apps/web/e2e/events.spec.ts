import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

// A student (simple view) manages an event; an admin restores it.
loginOnce('events', process.env.E2E_TOKEN_EVENTS, { mode: 'simple' });
test.describe.configure({ mode: 'serial' });

let eventUrl = '';

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

test('an invalid form shows the Polish message', async ({ page }) => {
  await page.goto('/s/wydarzenia/nowe');
  await page.getByLabel('Tytuł').fill('Coś');
  await page.getByLabel('Data').fill('2001-01-01');
  await page.getByRole('button', { name: 'Dodaj wydarzenie' }).click();
  await expect(
    page.getByText('Data nie może być więcej niż miesiąc wstecz.'),
  ).toBeVisible();
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
    await p.goto(`http://localhost:3100${eventUrl.replace('/s', '')}`);
    await expect(p.getByText('Wydarzenie usunięte')).toBeVisible();
    await p.getByRole('button', { name: 'Przywróć' }).click();
    await expect(p.getByText('Wydarzenie usunięte')).toBeHidden();
    await expect(p.getByText('Przywrócono wydarzenie')).toBeVisible();
  } finally {
    await admin.close();
  }
});

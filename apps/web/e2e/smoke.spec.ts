import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('anonymous visitors are sent to login info', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login-info/);
  await expect(page.getByText('wpisz /link')).toBeVisible();
});

test('browse, preview, search and sql console', async ({ page }) => {
  const link = `/auth/callback?token=${process.env.E2E_TOKEN}`;
  // A Discord link preview / mail scanner fetching the link must not burn it.
  for (let n = 0; n < 2; n++) {
    const preview = await page.request.get(link, { maxRedirects: 0 });
    expect(preview.status()).toBe(200);
    expect(preview.headers()['set-cookie']).toBeUndefined();
  }
  await page.goto(link);
  await expect(
    page.getByRole('heading', { name: 'Zaloguj się do Studies DB' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page).toHaveURL(/\/$/);
  const main = page.getByRole('main');
  // Home is the Przedmioty grid; the subject name links to the subject.
  await expect(
    page.getByRole('heading', { name: 'Przedmioty' }),
  ).toBeAttached();
  await main.getByRole('link', { name: 'Fizyka techniczna' }).click();
  await expect(page).toHaveURL(/\/subjects\/FIZ$/);
  await expect(
    page.getByRole('heading', { name: 'Fizyka techniczna' }),
  ).toBeVisible();
  // The active subject is open in the nav tree; a class link filters the grid.
  const tree = page.getByRole('navigation', { name: 'Drzewo bazy danych' });
  await tree.getByRole('link', { name: /Bez kategorii/ }).click();
  await expect(page).toHaveURL(/\/subjects\/FIZ\?class=none$/);
  await main
    .getByRole('link', { name: 'Kolokwium 1 — tarcie' })
    .first()
    .click();
  await expect(page).toHaveURL(/\/subjects\/FIZ\?topic=(\d+)$/);
  const topicId = /topic=(\d+)/.exec(page.url())?.[1];

  // The old topic URL lands in the explorer.
  await page.goto(`/topics/${topicId}`);
  await expect(page).toHaveURL(new RegExp(`/subjects/FIZ\\?topic=${topicId}$`));

  // Projektant: a table box links to the view browser.
  await page.goto('/schema');
  await expect(
    page.getByRole('heading', { name: 'Projektant' }),
  ).toBeAttached();
  const filesNode = page.getByRole('link', { name: /^Tabela v_files,/ });
  await expect(filesNode).toBeVisible();
  await filesNode.click();
  await expect(page).toHaveURL(/\/tables\/v_files$/);
  await page.goto(`/subjects/FIZ?topic=${topicId}`);

  // Statuses are visible in the grid without opening anything.
  await expect(main.getByText('Przetwarzanie…')).toBeVisible();
  await expect(main.getByText('Podgląd niedostępny')).toBeVisible();

  await main.getByRole('link', { name: 'sample.pdf' }).click();
  const panel = page.getByRole('complementary', { name: 'Podgląd pliku' });
  const canvas = panel.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole('link', { name: 'Pełny ekran' })).toBeVisible();
  // The PDF page is sized to its container (360 px side panel / full-width mobile sheet).
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 375, height: 800 });
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeGreaterThan(320);
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeLessThanOrEqual(375);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeLessThanOrEqual(360);

  // A file still being processed: a processing placeholder, not "unavailable".
  await main.getByRole('link', { name: 'notatki.docx' }).click();
  await expect(panel.getByText('notatki.docx', { exact: true })).toBeVisible();
  await expect(panel.getByText('Przetwarzanie…')).toBeVisible();
  await expect(
    panel.getByText('Podgląd pojawi się po przetworzeniu pliku'),
  ).toBeVisible();
  await expect(panel.getByText('Podgląd niedostępny')).toHaveCount(0);

  // A file without a preview: no "Pełny ekran", download works, Discord link set.
  await main.getByRole('link', { name: 'prezentacja.pptx' }).click();
  await expect(
    panel.getByText('prezentacja.pptx', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('Podgląd niedostępny').first()).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Pełny ekran' })).toHaveCount(0);
  const href = await panel
    .getByRole('link', { name: 'Pobierz' })
    .getAttribute('href');
  const res = await page.request.get(href as string);
  expect(res.status()).toBe(200);
  await expect(
    panel.getByRole('link', { name: 'Otwórz w Discordzie' }),
  ).toHaveAttribute(
    'href',
    'https://discord.com/channels/e2eguild/e2e-thread/m3',
  );
  // Closing the panel drops only `file`.
  await panel.getByRole('link', { name: 'Zamknij podgląd' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?class=none&topic=${topicId}$`));
  await expect(panel).toHaveCount(0);

  // "Otwórz w SQL" prefills the subject's SQL tab without running it.
  await main.getByRole('link', { name: 'Otwórz w SQL' }).click();
  await expect(page).toHaveURL(/tab=sql&q=/);
  await expect(page.locator('.cm-content')).toContainText(
    "subject_code = 'FIZ'",
  );
  await expect(main.getByRole('cell', { name: 'sample.pdf' })).toHaveCount(0);
  // The Pliki filename filter never becomes the SQL tab's query.
  await page.goto('/subjects/FIZ?q=sample');
  const sqlTab = page
    .getByRole('navigation', { name: 'Zakładki' })
    .getByRole('link', { name: 'SQL' });
  await expect(sqlTab).toHaveAttribute('href', '/subjects/FIZ?tab=sql');

  await page.goto('/search?q=tarcie');
  await expect(page.locator('mark').first()).toBeVisible();

  // The Eksport tab keeps the active filters and sort.
  await page.goto('/tables/v_subjects?sort=name&dir=desc&f_name=Fizyka');
  const csvLink = page
    .getByRole('navigation', { name: 'Zakładki' })
    .getByRole('link', { name: 'Eksport' });
  await expect(csvLink).toHaveAttribute(
    'href',
    '/tables/v_subjects/csv?sort=name&dir=desc&f_name=Fizyka',
  );
  const tableCsv = await page.request.get(
    (await csvLink.getAttribute('href')) as string,
  );
  expect(tableCsv.status()).toBe(200);
  expect(await tableCsv.text()).toContain('Fizyka techniczna');

  // File rows in the table browser open the same preview panel.
  await page.goto(
    '/tables/v_files?sort=filename&dir=asc&f_filename=prezentacja',
  );
  await main.getByRole('link', { name: 'prezentacja.pptx' }).first().click();
  await expect(page).toHaveURL(/preview=\d+/);
  const tablePanel = page.getByRole('complementary', { name: 'Podgląd pliku' });
  await expect(tablePanel.getByRole('link', { name: 'Pobierz' })).toBeVisible();
  await tablePanel.getByRole('link', { name: 'Zamknij podgląd' }).click();
  await expect(tablePanel).toHaveCount(0);
  await expect(page).toHaveURL(
    /\/tables\/v_files\?sort=filename&dir=asc&f_filename=prezentacja$/,
  );

  await page.goto('/sql');
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('SELECT 1 AS x');
  await page.getByRole('button', { name: 'Wykonaj' }).click();
  await expect(
    page.getByRole('cell', { name: '1', exact: true }),
  ).toBeVisible();
  // The run lands in the console footer's query history.
  await page.getByRole('button', { name: /Historia zapytań \(1\)/ }).click();
  await expect(
    page
      .locator('#console-history')
      .getByRole('link', { name: /SELECT 1 AS x/ }),
  ).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Eksport CSV' }).first().click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^zapytanie-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/,
  );
  const csv = await readFile((await download.path()) as string, 'utf8');
  expect(csv).toContain('x');
  expect(csv).toContain('1');

  // A non-JSON error (e.g. tunnel 502 page) is a server error, not a logout.
  await page.route('**/api/sql', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'text/html',
      body: '<html>Bad gateway</html>',
    }),
  );
  await page.getByRole('button', { name: 'Wykonaj' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Błąd serwera (502).' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/sql$/);
  await expect(editor).toHaveText('SELECT 1 AS x');
  await page.unroute('**/api/sql');

  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('DELETE FROM v_subjects');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /\S/ })
      .filter({ hasNotText: 'Błąd serwera' }),
  ).toBeVisible();
});

import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { loginOnce } from './session';

loginOnce('import', process.env.E2E_TOKEN_IMPORT, { mode: 'simple' });

const GROUPS = '/s/plan?tab=groups';
const FIXTURE = fileURLToPath(
  new URL('./fixtures/personal.ics', import.meta.url),
);

test('a UniTime calendar file fills My groups', async ({ page }) => {
  await page.goto(GROUPS);
  const section = page.getByRole('region', { name: 'Import from UniTime' });
  await section.getByLabel('or upload a .ics file').setInputFiles(FIXTURE);
  await section.getByRole('button', { name: 'Preview' }).click();

  const status = section.getByRole('status');
  await expect(status).toContainText('Chemia ogólna · Ćwiczenia: Gr. 2');
  await expect(status).toContainText('entries not matched');
  const apply = section.getByRole('button', { name: 'Apply 1 groups' });
  await expect(apply).toBeVisible();
  await apply.click();
  await expect(status).toHaveText('Groups saved: 1.');

  await expect(
    page.getByLabel(/Chemia ogólna.*Ćwiczenia/).locator('option:checked'),
  ).toHaveText('Gr. 2');

  // The same calendar again: nothing left to change.
  await section.getByLabel('or upload a .ics file').setInputFiles(FIXTURE);
  await section.getByRole('button', { name: 'Preview' }).click();
  await expect(status).toContainText('(already set)');
  await expect(status).toContainText(
    'Your groups already match this calendar.',
  );
  await expect(section.getByRole('button', { name: /^Apply/ })).toHaveCount(0);
});

test('a link from another host is refused without being echoed', async ({
  page,
}) => {
  await page.goto(GROUPS);
  const section = page.getByRole('region', { name: 'Import from UniTime' });
  await section
    .getByLabel('UniTime calendar link')
    .fill('https://evil.example.com/cal.ics?token=secret');
  await section.getByRole('button', { name: 'Preview' }).click();
  const alert = section.getByRole('alert');
  await expect(alert).toContainText('can be imported');
  await expect(alert).not.toContainText('secret');
});

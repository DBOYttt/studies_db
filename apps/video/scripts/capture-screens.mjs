// Captures the screenshots the tutorial video is built from, from the running
// dev server (pnpm dev:web on :3000, seeded with pnpm db:seed) as the seeded
// student seed-u1, in the dark theme. Desktop shots are 1600x900 CSS px at 1.2x = 1920x1080.
//   node apps/video/scripts/capture-screens.mjs
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const out = fileURLToPath(new URL('../public/screens/', import.meta.url));
const base = process.env.APP_URL || 'http://localhost:3000';
// Playwright comes from the web app's e2e setup.
const { chromium, devices } = createRequire(`${root}apps/web/package.json`)(
  '@playwright/test',
);

const loginLink = () => {
  const text = execSync('pnpm -s db:login seed-u1', { cwd: root }).toString();
  const url = text.match(/https?:\/\/\S+\/auth\/callback\?token=\S+/)?.[0];
  if (!url) throw new Error('no login link printed');
  return url.replace(/^https?:\/\/[^/]+/, base);
};

// The Next dev indicator is not part of the app.
const hideDevTools = (page) =>
  page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });

const shot = async (page, name, path, ready) => {
  if (path) await page.goto(base + path, { waitUntil: 'networkidle' });
  await hideDevTools(page);
  if (ready) await ready(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`${name}.png  ${page.url().replace(base, '')}`);
};

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

// Desktop, signed out, then signed in.
const desk = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1.2,
  colorScheme: 'dark',
});
const page = await desk.newPage();
await shot(page, 'login-info', '/login-info');
await shot(page, 'confirm', loginLink().replace(base, ''));
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(/\/s$/);
await page.waitForLoadState('networkidle');
await page.goto(`${base}/semester?to=all&next=/s`, {
  waitUntil: 'networkidle',
});
await shot(page, 'start', null);
await page.goto(`${base}/semester?to=2&next=/s`, { waitUntil: 'networkidle' });
await shot(page, 'start-sem2', null);
await page.goto(`${base}/semester?to=all&next=/s`, {
  waitUntil: 'networkidle',
});
await shot(page, 'subject', '/s/subjects/ASD');
await shot(page, 'preview', '/s/subjects/ASD?file=7', (p) =>
  p.locator('canvas').first().waitFor({ timeout: 15000 }),
);
await shot(page, 'plan', '/s/plan');
await shot(page, 'groups', '/s/plan?tab=groups');
await shot(page, 'events', '/s/wydarzenia');
await shot(page, 'event', '/s/wydarzenia/1');
await shot(page, 'event-new', '/s/wydarzenia/nowe', async (p) => {
  await p
    .getByRole('combobox', { name: 'Subject' })
    .selectOption({ label: 'BD · Bazy danych' });
  await p.getByRole('textbox', { name: 'Title' }).fill('Kolokwium z SQL');
});
await shot(page, 'search', '/s/search?q=sortowanie');
await desk.close();

// iPhone Safari: the Install app guide.
const phone = await browser.newContext({
  ...devices['iPhone 13'],
  colorScheme: 'dark',
});
const mob = await phone.newPage();
await mob.goto(base + loginLink().replace(base, ''), {
  waitUntil: 'networkidle',
});
await mob.getByRole('button', { name: 'Sign in' }).click();
await mob.waitForURL(/\/s$/);
await mob.waitForLoadState('networkidle');
await shot(mob, 'phone-start', null);
await mob.getByRole('button', { name: 'Install app' }).click();
await shot(mob, 'phone-install', null, (p) => p.getByRole('dialog').waitFor());
await phone.close();
await browser.close();

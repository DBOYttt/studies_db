// One-off: renders the home-screen icons from apps/web/app/icon.svg.
// Run with `node scripts/make-app-icons.mjs` after changing the icon; the
// PNGs are committed.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const web = join(import.meta.dirname, '..', 'apps', 'web');
// sharp ships with Next (its image optimiser), so it is resolved through next.
const fromWeb = createRequire(join(web, 'package.json'));
const sharp = createRequire(fromWeb.resolve('next/package.json'))('sharp');
const svg = readFileSync(join(web, 'app', 'icon.svg'));
const BG = '#235a81';

/** The artwork without the rounded tile, to place on a full square. */
const glyph = Buffer.from(
  svg
    .toString()
    .replace(/<rect[^>]*\/>/, '')
    .replace(/<title>.*?<\/title>/, ''),
);

async function square(size, artShare, file) {
  const art = Math.round(size * artShare);
  const png = await sharp(glyph, { density: 1200 })
    .resize(art, art)
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: png, gravity: 'center' }])
    .flatten({ background: BG })
    .png()
    .toFile(file);
}

// "any" icons: the full-bleed square reads well on every launcher; the
// maskable one keeps the artwork inside the 80 % safe zone.
await square(192, 1, join(web, 'public', 'icons', 'icon-192.png'));
await square(512, 1, join(web, 'public', 'icons', 'icon-512.png'));
await square(512, 0.8, join(web, 'public', 'icons', 'icon-maskable-512.png'));
// iOS rounds the corners itself and needs an opaque image.
await square(180, 1, join(web, 'app', 'apple-icon.png'));

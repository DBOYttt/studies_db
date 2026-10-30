import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertToPdf, MAX_PREVIEW_BYTES } from '../src/convert.js';
import { run } from '../src/exec.js';
import { extractPdfText } from '../src/extract.js';
import { writeHardenedProfile } from '../src/soffice-profile.js';

const hasSoffice = (() => {
  try {
    execFileSync('sh', ['-c', 'command -v soffice'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const fx = (n: string) =>
  fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));

let dir: string;
let token: string;
let linked: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'conv-hard-'));
  token = `leak${randomBytes(8).toString('hex')}`;
  const secret = join(dir, 'secret.txt');
  await writeFile(secret, `${token}\n`);
  // A section whose content is a link to a local file. The cached text is
  // "placeholder"; an update on load would replace it with the secret.
  linked = join(dir, 'linked.fodt');
  await writeFile(
    linked,
    `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
<office:settings><config:config-item-set config:name="ooo:configuration-settings"><config:config-item config:name="LinkUpdateMode" config:type="short">2</config:config-item></config:config-item-set></office:settings>
<office:body><office:text>
<text:p>Visible paragraph</text:p>
<text:section text:name="S1"><text:section-source xlink:href="${pathToFileURL(secret).href}" xlink:type="simple" text:filter-name="Text"/><text:p>placeholder</text:p></text:section>
</office:text></office:body></office:document>
`,
  );
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!hasSoffice)('convertToPdf hardening', () => {
  it('does not render a linked local file into the preview', async () => {
    const out = join(dir, 'linked.pdf');
    await convertToPdf(linked, out);
    const text = await extractPdfText(out);
    expect(text).toContain('Visible paragraph');
    expect(text).not.toContain(token);
  }, 120_000);

  it('baseline: an unseeded default profile does not leak it either', async () => {
    // Plain soffice with a fresh, unseeded profile, as before the hardening.
    // This pins the observed behaviour of the installed LibreOffice.
    const tmp = await mkdtemp(join(dir, 'raw-'));
    const outDir = join(tmp, 'out');
    await run(
      'soffice',
      [
        `-env:UserInstallation=${pathToFileURL(join(tmp, 'profile')).href}`,
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        linked,
      ],
      120_000,
      { home: tmp },
    );
    const text = await extractPdfText(join(outDir, 'linked.pdf'));
    expect(text).toContain('Visible paragraph');
    expect(text).not.toContain(token);
  }, 120_000);

  it('LibreOffice accepts and keeps the seeded settings', async () => {
    const tmp = await mkdtemp(join(dir, 'seeded-'));
    const profile = join(tmp, 'profile');
    await writeHardenedProfile(profile);
    await run(
      'soffice',
      [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        join(tmp, 'out'),
        fx('sample.docx'),
      ],
      120_000,
      { home: tmp },
    );
    // soffice rewrites the file on exit; a rejected item would be dropped.
    const xcu = await readFile(
      join(profile, 'user', 'registrymodifications.xcu'),
      'utf8',
    );
    for (const [path, name, value] of [
      ['/org.openoffice.Office.Writer/Content/Update', 'Link', '0'],
      ['/org.openoffice.Office.Calc/Content/Update', 'Link', '1'],
      [
        '/org.openoffice.Office.Common/Security/Scripting',
        'MacroSecurityLevel',
        '3',
      ],
      [
        '/org.openoffice.Office.Common/Security/Scripting',
        'DisableMacrosExecution',
        'true',
      ],
      [
        '/org.openoffice.Office.Common/Security/Scripting',
        'BlockUntrustedRefererLinks',
        'true',
      ],
    ]) {
      expect(xcu).toContain(
        `<item oor:path="${path}"><prop oor:name="${name}" oor:op="fuse"><value>${value}</value></prop></item>`,
      );
    }
  }, 120_000);

  it('fails and deletes a preview over the size cap', async () => {
    expect(MAX_PREVIEW_BYTES).toBe(200 * 1024 * 1024);
    const outDir = join(dir, 'capped');
    const out = join(outDir, 'big.pdf');
    await expect(
      convertToPdf(fx('sample.docx'), out, { maxPreviewBytes: 100 }),
    ).rejects.toThrow('Preview too large.');
    // Nothing reached the previews dir, not even a staged temp file.
    const left = await readdir(outDir).catch(() => []);
    expect(left).toEqual([]);
  }, 120_000);
});

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hardenedXcu, writeHardenedProfile } from '../src/soffice-profile.js';

const item = (path: string, name: string, value: string) =>
  `<item oor:path="${path}"><prop oor:name="${name}" oor:op="fuse"><value>${value}</value></prop></item>`;

describe('hardened LibreOffice profile', () => {
  it('turns off link updates and macros', () => {
    const xcu = hardenedXcu();
    expect(xcu).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xcu).toContain('xmlns:oor="http://openoffice.org/2001/registry"');
    // Writer UpdateLinks: 0 = NEVER (sw/inc/linkenum.hxx).
    expect(xcu).toContain(
      item('/org.openoffice.Office.Writer/Content/Update', 'Link', '0'),
    );
    // Calc ScLkUpdMode: 1 = LM_NEVER (sc/inc/global.hxx).
    expect(xcu).toContain(
      item('/org.openoffice.Office.Calc/Content/Update', 'Link', '1'),
    );
    const sec = '/org.openoffice.Office.Common/Security/Scripting';
    expect(xcu).toContain(item(sec, 'MacroSecurityLevel', '3'));
    expect(xcu).toContain(item(sec, 'DisableMacrosExecution', 'true'));
    expect(xcu).toContain(item(sec, 'BlockUntrustedRefererLinks', 'true'));
  });

  it('writes user/registrymodifications.xcu into the profile dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xcu-test-'));
    try {
      await writeHardenedProfile(join(dir, 'profile'));
      expect(
        await readFile(
          join(dir, 'profile', 'user', 'registrymodifications.xcu'),
          'utf8',
        ),
      ).toBe(hardenedXcu());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

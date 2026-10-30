import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Setting = {
  path: string;
  name: string;
  type: 'int' | 'boolean';
  value: number | boolean;
};

/**
 * Settings seeded into each conversion's fresh profile. Paths and value
 * meanings were checked against the officecfg schema (main.xcd) and the
 * LibreOffice source that reads them:
 * - Writer `Content/Update/Link` is `UpdateLinks` (sw/inc/linkenum.hxx):
 *   0 NEVER, 1 MANUAL, 2 AUTOMATIC.
 * - Calc `Content/Update/Link` is `ScLkUpdMode` (sc/inc/global.hxx):
 *   0 LM_ALWAYS, 1 LM_NEVER, 2 LM_ON_DEMAND.
 * - `MacroSecurityLevel` 3 is "very high" (only signed macros from trusted
 *   locations), and `DisableMacrosExecution` turns all scripting off.
 */
export const HARDENED_SETTINGS: readonly Setting[] = [
  {
    path: '/org.openoffice.Office.Writer/Content/Update',
    name: 'Link',
    type: 'int',
    value: 0,
  },
  {
    path: '/org.openoffice.Office.Calc/Content/Update',
    name: 'Link',
    type: 'int',
    value: 1,
  },
  {
    path: '/org.openoffice.Office.Common/Security/Scripting',
    name: 'MacroSecurityLevel',
    type: 'int',
    value: 3,
  },
  {
    path: '/org.openoffice.Office.Common/Security/Scripting',
    name: 'DisableMacrosExecution',
    type: 'boolean',
    value: true,
  },
  {
    path: '/org.openoffice.Office.Common/Security/Scripting',
    name: 'BlockUntrustedRefererLinks',
    type: 'boolean',
    value: true,
  },
];

export function hardenedXcu(): string {
  const items = HARDENED_SETTINGS.map(
    (s) =>
      `<item oor:path="${s.path}"><prop oor:name="${s.name}" oor:op="fuse"><value>${String(s.value)}</value></prop></item>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    ...items,
    '</oor:items>',
    '',
  ].join('\n');
}

/**
 * Seeds a not-yet-used LibreOffice profile dir (the `-env:UserInstallation`
 * target) so linked content is never updated and macros never run.
 */
export async function writeHardenedProfile(profileDir: string): Promise<void> {
  const userDir = join(profileDir, 'user');
  await mkdir(userDir, { recursive: true });
  await writeFile(join(userDir, 'registrymodifications.xcu'), hardenedXcu());
}

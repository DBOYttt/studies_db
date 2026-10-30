import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fileExtension,
  openInStorage,
  originalRelPath,
  planProcessing,
  previewRelPath,
  resolveInStorage,
  resolveStorageDir,
  StorageAccessError,
  StoragePathError,
  searchNameFor,
} from '../src/files.js';

describe('planProcessing', () => {
  it.each([
    [
      'w1.pdf',
      'application/pdf',
      { previewKind: 'pdf', jobs: ['extract_text'] },
    ],
    // extract_text is enqueued by convert later
    ['SLAJDY.PPTX', '', { previewKind: 'pdf', jobs: ['convert'] }],
    ['lab.docx', '', { previewKind: 'pdf', jobs: ['convert'] }],
    ['dane.xlsx', '', { previewKind: 'pdf', jobs: ['convert'] }],
    [
      'notatki.md',
      'text/markdown',
      { previewKind: 'text', jobs: ['extract_text'] },
    ],
    ['main.cpp', '', { previewKind: 'text', jobs: ['extract_text'] }],
    ['tablica.JPG', 'image/jpeg', { previewKind: 'image', jobs: [] }],
    ['archiwum.tar.gz', '', { previewKind: 'none', jobs: [] }],
    ['Makefile', '', { previewKind: 'none', jobs: [] }],
    // mime text/* wins when ext unknown
    [
      'dziwny.bin',
      'text/plain',
      { previewKind: 'text', jobs: ['extract_text'] },
    ],
  ])('plans %s (%s)', (filename, mime, expected) => {
    expect(planProcessing(filename, mime)).toEqual(expected);
  });
});

describe('fileExtension', () => {
  it('returns the lowercase last extension without the dot', () => {
    expect(fileExtension('notes.tar.gz')).toBe('gz');
    expect(fileExtension('TABLICA.JPG')).toBe('jpg');
  });

  it('returns an empty string when there is no extension', () => {
    expect(fileExtension('Makefile')).toBe('');
  });
});

describe('storage paths', () => {
  const sha = 'ab'.repeat(32);

  it('builds the original path with extension', () => {
    expect(originalRelPath(sha, 'pdf')).toBe(`originals/${sha}.pdf`);
  });

  it('builds the original path without extension', () => {
    expect(originalRelPath(sha, '')).toBe(`originals/${sha}`);
  });

  it('builds the preview path', () => {
    expect(previewRelPath(sha)).toBe(`previews/${sha}.pdf`);
  });

  it.each([
    '',
    'AB'.repeat(32),
    'ab'.repeat(31),
    `${'ab'.repeat(32)}0`,
    '../../../../tmp/x',
    `${'ab'.repeat(31)}/.`,
  ])('rejects a malformed sha256: %j', (bad) => {
    expect(() => previewRelPath(bad)).toThrow(StoragePathError);
    expect(() => originalRelPath(bad, 'pdf')).toThrow(StoragePathError);
  });
});

describe('resolveInStorage', () => {
  const root = '/data/storage';

  it.each([
    ['originals/a.pdf', '/data/storage/originals/a.pdf'],
    ['previews/../originals/a', '/data/storage/originals/a'],
    ['./x', '/data/storage/x'],
  ])('keeps %j inside the root', (rel, abs) => {
    expect(resolveInStorage(root, rel)).toBe(abs);
    expect(resolveInStorage(`${root}/`, rel)).toBe(abs);
  });

  it.each([
    '../../proc/self/environ',
    '/etc/passwd',
    '../storage-other/x',
    '..',
    '.',
    '',
  ])('refuses %j', (rel) => {
    expect(() => resolveInStorage(root, rel)).toThrow(StoragePathError);
  });

  it('uses a message that does not echo the path', () => {
    expect(() => resolveInStorage(root, '/etc/passwd')).toThrow(
      /^Invalid file path$/,
    );
  });
});

describe('openInStorage', () => {
  let root: string;
  let outside: string;
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  const setup = async () => {
    root = await mkdtemp(join(tmpdir(), 'open-in-storage-'));
    outside = await mkdtemp(join(tmpdir(), 'open-outside-'));
    await mkdir(join(root, 'originals'));
    await writeFile(join(root, 'originals', 'a.txt'), 'hello');
    await writeFile(join(outside, 'secret'), 'secret');
  };

  it('opens a regular file and reports its size', async () => {
    await setup();
    const { handle, size } = await openInStorage(root, 'originals/a.txt');
    try {
      expect(size).toBe(5);
      expect((await handle.readFile()).toString()).toBe('hello');
    } finally {
      await handle.close();
    }
  });

  it('refuses a leaf symlink to a file outside storage', async () => {
    await setup();
    await symlink('/etc/hosts', join(root, 'originals', 'hosts'));
    await expect(openInStorage(root, 'originals/hosts')).rejects.toThrow(
      StorageAccessError,
    );
  });

  it('refuses a leaf symlink even when it points inside storage', async () => {
    await setup();
    await symlink(
      join(root, 'originals', 'a.txt'),
      join(root, 'originals', 'b.txt'),
    );
    await expect(openInStorage(root, 'originals/b.txt')).rejects.toThrow(
      StorageAccessError,
    );
  });

  it('refuses a symlinked directory component', async () => {
    await setup();
    await symlink('/etc', join(root, 'uploads'));
    await expect(openInStorage(root, 'uploads/hosts')).rejects.toThrow(
      StorageAccessError,
    );
    await symlink(outside, join(root, 'up2'));
    await expect(openInStorage(root, 'up2/secret')).rejects.toThrow(
      StorageAccessError,
    );
  });

  it('refuses a directory and a FIFO (without blocking)', async () => {
    await setup();
    await expect(openInStorage(root, 'originals')).rejects.toThrow(
      StorageAccessError,
    );
    execFileSync('mkfifo', [join(root, 'originals', 'fifo')]);
    await expect(openInStorage(root, 'originals/fifo')).rejects.toThrow(
      StorageAccessError,
    );
  });

  it('refuses a missing file and a path that escapes', async () => {
    await setup();
    await expect(openInStorage(root, 'originals/nope')).rejects.toThrow(
      StorageAccessError,
    );
    await expect(openInStorage(root, '../x')).rejects.toThrow(
      StorageAccessError,
    );
  });

  it('works when the root itself is reached through a symlink', async () => {
    await setup();
    const link = `${root}-link`;
    await symlink(root, link);
    try {
      const { handle, size } = await openInStorage(link, 'originals/a.txt');
      await handle.close();
      expect(size).toBe(5);
    } finally {
      await rm(link, { force: true });
    }
  });

  it('uses a message that does not echo the path', async () => {
    await setup();
    await expect(openInStorage(root, 'originals/nope')).rejects.toThrow(
      /^File not available$/,
    );
  });
});

describe('fileExtension hardening', () => {
  it('ignores dots in directory components', () => {
    expect(fileExtension('a/b.d/Makefile')).toBe('');
    expect(fileExtension('a\\b.d\\Makefile')).toBe('');
  });
  it('rejects overlong or odd extensions', () => {
    expect(fileExtension(`x.${'a'.repeat(50)}`)).toBe('');
    expect(fileExtension('x.a b')).toBe('');
  });
  it('lowercases', () => {
    expect(fileExtension('x.PDF')).toBe('pdf');
  });
});

describe('planProcessing mime normalization', () => {
  it('handles case and parameters', () => {
    expect(planProcessing('scan', 'Application/PDF; charset=binary')).toEqual({
      previewKind: 'pdf',
      jobs: ['extract_text'],
    });
  });
});

describe('searchNameFor', () => {
  it('splits Discord-style names into words', () => {
    expect(searchNameFor('kolokwium_2023_zad1.jpg')).toBe(
      'kolokwium 2023 zad1 jpg',
    );
    expect(searchNameFor('  a--b__c..d  ')).toBe('a b c d');
  });
  it('folds ł so FULLTEXT matches it like the other diacritics', () => {
    expect(searchNameFor('Łańcuchy_złożone.pdf')).toBe('Lańcuchy zlożone pdf');
  });
});

describe('resolveStorageDir', () => {
  it('returns absolute paths unchanged', () => {
    expect(resolveStorageDir('/var/data/storage')).toBe('/var/data/storage');
  });

  it('resolves relative paths against the monorepo root', () => {
    const out = resolveStorageDir('./storage');
    expect(out.endsWith('/storage')).toBe(true);
    const root = out.slice(0, -'/storage'.length);
    const pkgPath = join(root, 'package.json');
    expect(existsSync(pkgPath)).toBe(true);
    expect(JSON.parse(readFileSync(pkgPath, 'utf8')).name).toBe('studies-db');
  });
});

describe('resolveStorageDir in production', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('rejects relative paths', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => resolveStorageDir('./storage')).toThrow(/absolute/);
    expect(resolveStorageDir('/data/storage')).toBe('/data/storage');
  });
});

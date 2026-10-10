import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fileExtension,
  originalRelPath,
  planProcessing,
  previewRelPath,
  resolveStorageDir,
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

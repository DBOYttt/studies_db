import { describe, expect, it } from 'vitest';
import {
  fileExtension,
  originalRelPath,
  planProcessing,
  previewRelPath,
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

import { describe, expect, it } from 'vitest';
import { escapeUserText } from '../src/markdown.js';

describe('escapeUserText', () => {
  it('breaks masked links', () => {
    expect(escapeUserText('[Notes](https://phish)')).toBe(
      '\\[Notes](https://phish)',
    );
    expect(escapeUserText('see [x](https://a) now')).toBe(
      'see \\[x](https://a) now',
    );
  });

  it('breaks headings, subtext, lists and quotes at line starts', () => {
    expect(
      escapeUserText(
        '# Big\n## x\n-# sub\n- item\n* star\n1. one\n> q\n>>> qq',
      ),
    ).toBe(
      '\\# Big\n\\## x\n\\-# sub\n\\- item\n\\* star\n1\\. one\n\\> q\n\\>>> qq',
    );
  });

  it('still does what escapeMarkdown does', () => {
    expect(escapeUserText('a_b*c~~d||e`f')).toBe('a\\_b\\*c\\~\\~d\\|\\|e\\`f');
  });

  it('leaves plain text alone', () => {
    expect(escapeUserText('Sala 2, budynek C - piętro 1 > 0')).toBe(
      'Sala 2, budynek C - piętro 1 > 0',
    );
  });
});

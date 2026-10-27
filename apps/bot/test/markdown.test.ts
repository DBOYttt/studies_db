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
    // discord.js's own masked-link escape is greedy and missed the second one.
    expect(escapeUserText('[a](x) [Notes](https://phish)')).toBe(
      '\\[a](x) \\[Notes](https://phish)',
    );
    expect(escapeUserText('[[x](y)')).toBe('\\[\\[x](y)');
    // A typed backslash stays a backslash; no double escaping.
    expect(escapeUserText('\\[x](y)')).toBe('\\\\\\[x](y)');
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

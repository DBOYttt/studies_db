import { describe, expect, it } from 'vitest';
import { checkTools } from '../src/tools.js';

describe('checkTools', () => {
  it('rejects naming a nonexistent binary', async () => {
    await expect(
      checkTools({
        sofficeBin: 'no-such-soffice-bin',
        pdftotextBin: 'pdftotext',
      }),
    ).rejects.toThrow(/missing tool no-such-soffice-bin/);
  });
  it('rejects on missing pdftotext', async () => {
    await expect(
      checkTools({ sofficeBin: 'true', pdftotextBin: 'no-such-pdftotext' }),
    ).rejects.toThrow(/missing tool no-such-pdftotext/);
  });
});

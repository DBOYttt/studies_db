import { describe, expect, it } from 'vitest';
import { toCsv } from '../lib/csv';

describe('toCsv', () => {
  it('quotes per RFC 4180 with CRLF and a UTF-8 BOM', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'z"q']])).toBe(
      '\uFEFFa,b\r\n"x,y","z""q"\r\n',
    );
  });
  it('handles newlines, nulls, numbers and Polish chars', () => {
    expect(
      toCsv(
        ['id', 'opis', 'x'],
        [
          [1, 'ża\nźć', null],
          [2, 'a\rb', true],
        ],
      ),
    ).toBe('\uFEFFid,opis,x\r\n1,"ża\nźć",\r\n2,"a\rb",true\r\n');
  });
  it('quotes header cells too', () => {
    expect(toCsv(['a,b'], [])).toBe('\uFEFF"a,b"\r\n');
  });
  it('neutralises spreadsheet formulas in strings only', () => {
    expect(
      toCsv(
        ['v'],
        [['=SUM(A1)'], ['@x'], ['+1'], ['-x'], ['\tx'], [-5], ['a=b']],
      ),
    ).toBe(
      "\uFEFFv\r\n'=SUM(A1)\r\n'@x\r\n'+1\r\n'-x\r\n'\tx\r\n-5\r\na=b\r\n",
    );
    // prefix is applied before RFC 4180 quoting
    expect(toCsv(['v'], [['=a,b'], ['\rx']])).toBe(
      '\uFEFFv\r\n"\'=a,b"\r\n"\'\rx"\r\n',
    );
  });
});

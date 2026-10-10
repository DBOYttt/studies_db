import { describe, expect, it } from 'vitest';
import { toCsv } from '../lib/csv';

describe('toCsv', () => {
  it('quotes per RFC 4180 with CRLF and a UTF-8 BOM', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'z"q']])).toBe('﻿a,b\r\n"x,y","z""q"\r\n');
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
    ).toBe('﻿id,opis,x\r\n1,"ża\nźć",\r\n2,"a\rb",true\r\n');
  });
  it('quotes header cells too', () => {
    expect(toCsv(['a,b'], [])).toBe('﻿"a,b"\r\n');
  });
});

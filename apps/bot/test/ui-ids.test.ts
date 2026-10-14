import { describe, expect, it } from 'vitest';
import { decodeId, encodeId } from '../src/ui/ids.js';

describe('component id codec', () => {
  it('round-trips area, action and args', () => {
    const id = encodeId('stu', 'plan', 'day', '2026-10-14');
    expect(id).toBe('v1:stu:plan:day:2026-10-14');
    expect(decodeId(id)).toEqual({
      area: 'stu',
      action: 'plan',
      args: ['day', '2026-10-14'],
    });
    expect(decodeId(encodeId('adm', 'subject', 12))).toEqual({
      area: 'adm',
      action: 'subject',
      args: ['12'],
    });
    expect(decodeId(encodeId('stu', 'login'))).toEqual({
      area: 'stu',
      action: 'login',
      args: [],
    });
  });

  it('treats undecodable ids as stale', () => {
    expect(decodeId('v2:stu:plan:day')).toBeNull();
    expect(decodeId('x')).toBeNull();
    expect(decodeId('v1:zzz:a')).toBeNull();
    expect(decodeId('v1:stu')).toBeNull();
    expect(decodeId('v1:stu:')).toBeNull();
    expect(decodeId('')).toBeNull();
  });

  it('throws past 100 characters', () => {
    // 'v1:stu:a:' is 9 characters.
    expect(encodeId('stu', 'a', 'x'.repeat(91))).toHaveLength(100);
    expect(() => encodeId('stu', 'a', 'x'.repeat(92))).toThrow();
  });

  it('throws on a colon in an arg or action', () => {
    expect(() => encodeId('stu', 'a', 'b:c')).toThrow();
    expect(() => encodeId('stu', 'a:b')).toThrow();
    expect(() => encodeId('stu', '')).toThrow();
  });
});

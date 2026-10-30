import { describe, expect, it } from 'vitest';
import {
  NOTICES,
  noticeFromSearchParams,
  SESSION_ENDED,
  withNotice,
} from '@/lib/notices';

describe('NOTICES', () => {
  it('maps each key to a fixed English sentence', () => {
    expect(NOTICES['event-deleted']).toBe('This event was deleted.');
    expect(SESSION_ENDED).toBe(
      'Your session has ended. Sign in again with /link in Discord.',
    );
  });
});

describe('noticeFromSearchParams', () => {
  it('returns the text of a known key', () => {
    expect(noticeFromSearchParams({ notice: 'event-deleted' })).toBe(
      'This event was deleted.',
    );
    expect(
      noticeFromSearchParams(new URLSearchParams('notice=event-deleted')),
    ).toBe('This event was deleted.');
  });
  it('ignores unknown, repeated, prototype and missing keys', () => {
    for (const notice of [
      undefined,
      '',
      'nope',
      '<script>alert(1)</script>',
      'This event was deleted.',
      'toString',
      '__proto__',
      'constructor',
      ['event-deleted', 'event-deleted'],
    ]) {
      expect(noticeFromSearchParams({ notice }), String(notice)).toBeNull();
    }
    expect(noticeFromSearchParams({})).toBeNull();
  });
});

describe('withNotice', () => {
  it('adds the key to an internal path, keeping its query', () => {
    expect(withNotice('/s/plan', 'event-deleted')).toBe(
      '/s/plan?notice=event-deleted',
    );
    expect(withNotice('/plan?week=2026-W46', 'event-deleted')).toBe(
      '/plan?week=2026-W46&notice=event-deleted',
    );
    expect(withNotice('/plan?notice=x#top', 'event-deleted')).toBe(
      '/plan?notice=event-deleted#top',
    );
  });
  it('refuses anything but an internal path', () => {
    for (const p of [
      'https://evil.example/',
      '//evil.example/x',
      '/\\evil.example',
      'plan',
      '',
      '/%2F%2Fevil.example',
      '/a\nb',
    ]) {
      expect(() => withNotice(p, 'event-deleted'), p).toThrow();
    }
  });
  it('refuses an unknown key', () => {
    expect(() =>
      withNotice('/s/plan', 'nope' as unknown as 'event-deleted'),
    ).toThrow();
  });
});

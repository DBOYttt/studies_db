import { describe, expect, it } from 'vitest';
import {
  fetchImportCalendar,
  importAllowedHosts,
  normalizeImportUrl,
  SafeSyncError,
} from '../src/unitime/fetch.js';

const HOSTS = ['plan.agh.edu.pl'];

describe('importAllowedHosts', () => {
  it('defaults to plan.agh.edu.pl', () => {
    expect(importAllowedHosts({})).toEqual(['plan.agh.edu.pl']);
  });
  it('merges configured hosts and feed hosts without duplicates', () => {
    const hosts = importAllowedHosts({
      UNITIME_IMPORT_HOSTS: 'A.example, b.example',
      UNITIME_ICAL_URL: 'https://feed.example/x?t=1',
      UNITIME_EXAM_ICAL_URL: 'https://feed.example/y',
    });
    expect(hosts).toEqual(['a.example', 'b.example', 'feed.example']);
  });
  it('ignores unparsable feed urls', () => {
    expect(importAllowedHosts({ UNITIME_ICAL_URL: 'nope' })).toEqual([
      'plan.agh.edu.pl',
    ]);
  });
});

describe('normalizeImportUrl', () => {
  it('trims and accepts https links', () => {
    expect(
      normalizeImportUrl(
        '  https://plan.agh.edu.pl/UniTime/export?x=abc  ',
        HOSTS,
      ),
    ).toEqual({
      ok: true,
      url: 'https://plan.agh.edu.pl/UniTime/export?x=abc',
      host: 'plan.agh.edu.pl',
    });
  });
  it('maps webcal:// to https://', () => {
    expect(
      normalizeImportUrl(
        'webcal://plan.agh.edu.pl/UniTime/export?x=abc',
        HOSTS,
      ),
    ).toMatchObject({
      ok: true,
      url: 'https://plan.agh.edu.pl/UniTime/export?x=abc',
    });
  });
  it('accepts uppercase host and explicit 443', () => {
    expect(normalizeImportUrl('https://PLAN.agh.edu.pl:443/x', HOSTS).ok).toBe(
      true,
    );
  });
  it('rejects with host-only messages', () => {
    expect(normalizeImportUrl('http://plan.agh.edu.pl/x', HOSTS)).toEqual({
      ok: false,
      error: 'Use an https:// link from plan.agh.edu.pl.',
    });
    expect(normalizeImportUrl('https://evil.example/x', HOSTS)).toEqual({
      ok: false,
      error: 'Only links from plan.agh.edu.pl can be imported.',
    });
    expect(normalizeImportUrl('not a url', HOSTS)).toEqual({
      ok: false,
      error: 'That is not a link.',
    });
    expect(normalizeImportUrl('https://u:p@plan.agh.edu.pl/x', HOSTS).ok).toBe(
      false,
    );
    expect(normalizeImportUrl('https://plan.agh.edu.pl:8443/x', HOSTS).ok).toBe(
      false,
    );
    expect(
      normalizeImportUrl(`https://plan.agh.edu.pl/${'a'.repeat(500)}`, HOSTS)
        .ok,
    ).toBe(false);
  });
  it('names the first allowed host', () => {
    const r = normalizeImportUrl('https://evil.example/x', [
      'x.example',
      'y.example',
    ]);
    expect(r).toEqual({
      ok: false,
      error: 'Only links from x.example can be imported.',
    });
  });
  it('never echoes the query or path', () => {
    for (const raw of [
      'http://plan.agh.edu.pl/secretpath?x=abc',
      'https://evil.example/secretpath?x=abc',
      'https://u:p@plan.agh.edu.pl/secretpath?x=abc',
    ]) {
      const r = normalizeImportUrl(raw, HOSTS);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).not.toContain('abc');
        expect(r.error).not.toContain('secretpath');
      }
    }
  });
});

describe('fetchImportCalendar', () => {
  it('rejects a body over 2 MiB', async () => {
    const fetchImpl = (async () =>
      new Response('x'.repeat(2 * 1024 * 1024 + 1), {
        headers: { 'content-type': 'text/calendar' },
      })) as unknown as typeof fetch;
    const p = fetchImportCalendar('https://plan.agh.edu.pl/x?t=abc', {
      fetchImpl,
    });
    await expect(p).rejects.toBeInstanceOf(SafeSyncError);
    await expect(p).rejects.toThrow(
      'The response from plan.agh.edu.pl is too large',
    );
  });
});

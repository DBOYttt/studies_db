import { describe, expect, it } from 'vitest';
import {
  hasActiveRequest,
  isStaleRequest,
  REQUEST_KIND_LABELS,
  STALE_AFTER_MS,
  STALE_TEXT,
  staleNotice,
} from '@/lib/admin-sync';

const now = new Date('2026-10-29T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('admin request helpers', () => {
  it('names the three kinds', () => {
    expect(REQUEST_KIND_LABELS).toEqual({
      setup: 'Setup',
      setup_dry_run: 'Setup preview',
      resync: 'Fetch from Discord',
    });
  });
  it('a queued request is stale after 60 s', () => {
    expect(STALE_AFTER_MS).toBe(60_000);
    expect(
      isStaleRequest({ status: 'queued', createdAt: ago(60_000) }, now),
    ).toBe(false);
    expect(
      isStaleRequest({ status: 'queued', createdAt: ago(60_001) }, now),
    ).toBe(true);
    expect(
      isStaleRequest({ status: 'running', createdAt: ago(600_000) }, now),
    ).toBe(false);
    expect(
      isStaleRequest({ status: 'done', createdAt: ago(600_000) }, now),
    ).toBe(false);
  });
  it('the notice is the exact copy, only when a queued one is stale', () => {
    expect(STALE_TEXT).toBe('The bot is not responding. Is it running?');
    expect(
      staleNotice([{ status: 'queued', createdAt: ago(61_000) }], now),
    ).toBe(STALE_TEXT);
    expect(
      staleNotice([{ status: 'queued', createdAt: ago(5_000) }], now),
    ).toBeNull();
    expect(staleNotice([], now)).toBeNull();
  });
  it('active means queued or running', () => {
    expect(hasActiveRequest([{ status: 'queued' }])).toBe(true);
    expect(hasActiveRequest([{ status: 'running' }])).toBe(true);
    expect(hasActiveRequest([{ status: 'done' }, { status: 'failed' }])).toBe(
      false,
    );
  });
});

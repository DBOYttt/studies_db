import { describe, expect, it } from 'vitest';
import {
  activeRequestText,
  canCancelRequest,
  feedHostHint,
  hasActiveRequest,
  isStaleRequest,
  planPendingText,
  REQUEST_KIND_LABELS,
  reportLabel,
  requestHref,
  requestStatusLabel,
  STALE_AFTER_MS,
  STALE_TEXT,
  STUCK_TEXT,
  staleNotice,
} from '@/lib/admin-sync';

const now = new Date('2026-10-29T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;

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
  it('a running request is stale once started more than 15 min ago', () => {
    const running = (startedMs: number) => ({
      status: 'running',
      createdAt: ago(startedMs + MIN),
      startedAt: ago(startedMs),
    });
    expect(isStaleRequest(running(15 * MIN), now)).toBe(false);
    expect(isStaleRequest(running(15 * MIN + 1), now)).toBe(true);
    expect(isStaleRequest(running(MIN), now)).toBe(false);
  });
  it('the notice is the exact copy, only when one is stale', () => {
    expect(STALE_TEXT).toBe('The bot is not responding. Is it running?');
    expect(STUCK_TEXT).toBe(
      'The bot has been working on this request for more than 15 minutes. It may be stuck: cancel it or restart the bot.',
    );
    expect(
      staleNotice([{ status: 'queued', createdAt: ago(61_000) }], now),
    ).toBe(STALE_TEXT);
    expect(
      staleNotice([{ status: 'queued', createdAt: ago(5_000) }], now),
    ).toBeNull();
    expect(
      staleNotice(
        [
          {
            status: 'running',
            createdAt: ago(20 * MIN),
            startedAt: ago(16 * MIN),
          },
        ],
        now,
      ),
    ).toBe(STUCK_TEXT);
    expect(
      staleNotice(
        [{ status: 'running', createdAt: ago(2 * MIN), startedAt: ago(MIN) }],
        now,
      ),
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
  it('the panel header says queued or in progress', () => {
    expect(activeRequestText([{ status: 'queued' }])).toBe(
      'A request is queued',
    );
    expect(activeRequestText([{ status: 'running' }, { status: 'done' }])).toBe(
      'A request is in progress',
    );
    expect(activeRequestText([{ status: 'done' }])).toBeNull();
  });
  it('a cancelled request shows as cancelled', () => {
    expect(requestStatusLabel({ status: 'failed', error: 'Cancelled.' })).toBe(
      'cancelled',
    );
    expect(requestStatusLabel({ status: 'failed', error: 'boom' })).toBe(
      'failed',
    );
    expect(requestStatusLabel({ status: 'done', error: null })).toBe('done');
  });
  it('cancel is offered for queued and stuck running requests', () => {
    expect(canCancelRequest({ status: 'queued', createdAt: ago(0) }, now)).toBe(
      true,
    );
    expect(
      canCancelRequest(
        {
          status: 'running',
          createdAt: ago(20 * MIN),
          startedAt: ago(16 * MIN),
        },
        now,
      ),
    ).toBe(true);
    expect(
      canCancelRequest(
        { status: 'running', createdAt: ago(2 * MIN), startedAt: ago(MIN) },
        now,
      ),
    ).toBe(false);
    expect(canCancelRequest({ status: 'done', createdAt: ago(0) }, now)).toBe(
      false,
    );
  });
  it('labels and links the report', () => {
    expect(reportLabel(12)).toBe('Report (12 chars)');
    expect(reportLabel(60_001)).toBe('Report (60,001 chars)');
    expect(requestHref(42)).toBe('/admin/sync/requests/42');
  });
});

describe('planPendingText', () => {
  const at = new Date('2026-10-31T01:05:00Z'); // 02:05 in Warsaw (CET)
  it('says when the sync was requested while the worker has not run since', () => {
    const text = 'Sync requested at 02:05 (Warsaw), waiting for the worker.';
    expect(planPendingText({ requestedAt: at, lastRunAt: null })).toBe(text);
    expect(
      planPendingText({
        requestedAt: at,
        lastRunAt: new Date('2026-10-31T00:00:00Z'),
      }),
    ).toBe(text);
  });
  it('is null with no request, or once the worker ran after it', () => {
    expect(planPendingText({ requestedAt: null, lastRunAt: null })).toBeNull();
    expect(
      planPendingText({
        requestedAt: at,
        lastRunAt: new Date('2026-10-31T01:06:00Z'),
      }),
    ).toBeNull();
    expect(planPendingText({ requestedAt: at, lastRunAt: at })).toBeNull();
  });
  it('uses summer time in summer', () => {
    expect(
      planPendingText({
        requestedAt: new Date('2026-07-01T10:30:00Z'),
        lastRunAt: null,
      }),
    ).toBe('Sync requested at 12:30 (Warsaw), waiting for the worker.');
  });
});

describe('feedHostHint', () => {
  it('names the first allowed host only', () => {
    expect(feedHostHint(['plan.agh.edu.pl', 'other.example'])).toBe(
      'Only https links on plan.agh.edu.pl.',
    );
    expect(feedHostHint([])).toBe('Only https links on the configured host.');
  });
});

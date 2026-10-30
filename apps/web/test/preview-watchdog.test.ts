import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewWatchdog,
  PREVIEW_TIMEOUT_MS,
} from '../lib/preview-watchdog';

describe('createPreviewWatchdog', () => {
  const onFail = vi.fn();
  const make = () =>
    createPreviewWatchdog({
      onFail,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    });
  beforeEach(() => {
    vi.useFakeTimers();
    onFail.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('gives up 15 s after start without a first render', () => {
    expect(PREVIEW_TIMEOUT_MS).toBe(15_000);
    const w = make();
    w.start();
    vi.advanceTimersByTime(14_999);
    expect(onFail).not.toHaveBeenCalled();
    expect(w.status()).toBe('loading');
    vi.advanceTimersByTime(1);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(w.status()).toBe('failed');
  });

  it('a first render in time stops the timer for good', () => {
    const w = make();
    w.start();
    vi.advanceTimersByTime(10_000);
    w.rendered();
    vi.advanceTimersByTime(60_000);
    expect(onFail).not.toHaveBeenCalled();
    expect(w.status()).toBe('shown');
    // A late error after the page is on screen keeps the preview.
    w.failed();
    expect(w.status()).toBe('shown');
    expect(onFail).not.toHaveBeenCalled();
  });

  it('a load error fails at once, only once', () => {
    const w = make();
    w.start();
    vi.advanceTimersByTime(2_000);
    w.failed();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(w.status()).toBe('failed');
    vi.advanceTimersByTime(60_000);
    w.failed();
    w.rendered();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(w.status()).toBe('failed');
  });

  it('stop() (unmount, another file) cancels the timer', () => {
    const w = make();
    w.start();
    w.stop();
    vi.advanceTimersByTime(60_000);
    expect(onFail).not.toHaveBeenCalled();
  });
});

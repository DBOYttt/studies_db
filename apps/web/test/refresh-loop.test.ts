import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefreshLoop, refreshDelay } from '../lib/refresh-loop';

describe('refreshDelay', () => {
  it('backs off 3, 6, 12, 30 s and stays at 30 s', () => {
    expect([0, 1, 2, 3, 4, 50].map(refreshDelay)).toEqual([
      3000, 6000, 12000, 30000, 30000, 30000,
    ]);
  });
});

describe('createRefreshLoop', () => {
  let hidden = false;
  const refresh = vi.fn();
  const make = () =>
    createRefreshLoop({
      refresh,
      isHidden: () => hidden,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    });
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    refresh.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('refreshes at 3, 9, 21, 51 and then every 30 s', () => {
    const loop = make();
    loop.start();
    vi.advanceTimersByTime(2999);
    expect(refresh).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6000);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(12000);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(30000);
    expect(refresh).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(60000);
    expect(refresh).toHaveBeenCalledTimes(6);
    loop.stop();
  });

  it('stops for good', () => {
    const loop = make();
    loop.start();
    loop.stop();
    vi.advanceTimersByTime(120000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('pauses while hidden and restarts from 3 s when shown', () => {
    const loop = make();
    loop.start();
    vi.advanceTimersByTime(3000 + 6000); // two refreshes, next delay 12 s
    expect(refresh).toHaveBeenCalledTimes(2);
    hidden = true;
    loop.visibilityChanged();
    vi.advanceTimersByTime(300000);
    expect(refresh).toHaveBeenCalledTimes(2);
    hidden = false;
    loop.visibilityChanged();
    vi.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(6000);
    expect(refresh).toHaveBeenCalledTimes(4);
    loop.stop();
  });

  it('a timer that fires while hidden neither refreshes nor reschedules', () => {
    const loop = make();
    loop.start();
    hidden = true; // no visibilitychange delivered
    vi.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(300000);
    expect(refresh).toHaveBeenCalledTimes(0);
    loop.stop();
  });

  it('ignores visibility changes before start / after stop', () => {
    const loop = make();
    loop.visibilityChanged();
    vi.advanceTimersByTime(10000);
    expect(refresh).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pushSqlHistory,
  readSqlHistory,
  SQL_HISTORY_EVENT,
  SQL_HISTORY_KEY,
} from '../lib/sql-history';

let store: Map<string, string>;
let events: string[];

beforeEach(() => {
  store = new Map();
  events = [];
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal('window', {
    dispatchEvent: (e: Event) => {
      events.push(e.type);
      return true;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('sql history', () => {
  it('reads an empty or broken history as []', () => {
    expect(readSqlHistory()).toEqual([]);
    store.set(SQL_HISTORY_KEY, '{nope');
    expect(readSqlHistory()).toEqual([]);
    store.set(SQL_HISTORY_KEY, JSON.stringify({ a: 1 }));
    expect(readSqlHistory()).toEqual([]);
    store.set(SQL_HISTORY_KEY, JSON.stringify(['a', 3, 'b']));
    expect(readSqlHistory()).toEqual(['a', 'b']);
  });

  it('pushes newest first, deduplicated, max 50, and notifies', () => {
    pushSqlHistory('a');
    pushSqlHistory('b');
    expect(pushSqlHistory('a')).toEqual(['a', 'b']);
    expect(JSON.parse(store.get(SQL_HISTORY_KEY) ?? '')).toEqual(['a', 'b']);
    expect(events).toEqual([
      SQL_HISTORY_EVENT,
      SQL_HISTORY_EVENT,
      SQL_HISTORY_EVENT,
    ]);
    for (let i = 0; i < 60; i++) pushSqlHistory(`q${i}`);
    const h = readSqlHistory();
    expect(h).toHaveLength(50);
    expect(h[0]).toBe('q59');
  });

  it('is a no-op outside the browser', () => {
    vi.unstubAllGlobals();
    expect(readSqlHistory()).toEqual([]);
    expect(pushSqlHistory('x')).toEqual(['x']);
  });
});

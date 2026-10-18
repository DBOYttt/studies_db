import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { addEvent } from '../src/events.js';
import { adminAudit, events, subjects, users } from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';
import { isRetryableTxError, withTxRetry } from '../src/tx.js';

const fakeDb = (errors: unknown[]) => {
  let calls = 0;
  const db = {
    transaction: async () => {
      calls++;
      if (errors.length) throw errors.shift();
      return 'ok';
    },
  } as unknown as Db;
  return { db, calls: () => calls };
};
const noPause = { pause: async () => {} };

describe('isRetryableTxError', () => {
  it('detects 1020, 1213 and 1205 on the error or its cause chain', () => {
    expect(isRetryableTxError({ errno: 1020 })).toBe(true);
    expect(isRetryableTxError({ cause: { errno: 1213 } })).toBe(true);
    expect(isRetryableTxError({ cause: { cause: { errno: 1205 } } })).toBe(
      true,
    );
  });
  it('rejects other errors', () => {
    expect(isRetryableTxError({ errno: 1062 })).toBe(false);
    expect(isRetryableTxError(new Error('x'))).toBe(false);
    expect(isRetryableTxError(null)).toBe(false);
  });
});

describe('withTxRetry', () => {
  it('retries a retryable error and then succeeds', async () => {
    const f = fakeDb([{ errno: 1020 }, { errno: 1020 }]);
    await expect(withTxRetry(f.db, async () => 1, noPause)).resolves.toBe('ok');
    expect(f.calls()).toBe(3);
  });
  it('gives up after 3 attempts', async () => {
    const err = { errno: 1020 };
    const f = fakeDb([err, err, err, err, err]);
    await expect(withTxRetry(f.db, async () => 1, noPause)).rejects.toBe(err);
    expect(f.calls()).toBe(3);
  });
  it('does not retry other errors', async () => {
    const err = { errno: 1062 };
    const f = fakeDb([err]);
    await expect(withTxRetry(f.db, async () => 1, noPause)).rejects.toBe(err);
    expect(f.calls()).toBe(1);
  });
});

describe('concurrent addEvent', () => {
  let db: Db;
  let subjectId: number;
  beforeAll(async () => {
    db = await resetTestDb();
    [{ id: subjectId }] = await db
      .insert(subjects)
      .values({ code: 'BD', name: 'Bazy danych', semester: 1, ects: 5 })
      .$returningId();
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  const when = () => {
    const d = new Date(Date.now() + 5 * 86_400_000);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getUTCFullYear()} 10:00-11:30`;
  };
  const user = async (name: string) =>
    (
      await db
        .insert(users)
        .values({ discordUserId: `d-${name}`, displayName: name })
        .$returningId()
    )[0].id;

  it('5 rounds of two parallel saves all succeed', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      const a = await user(`a${i}`);
      const b = await user(`b${i}`);
      const mk = (t: string) => ({
        kind: 'kolokwium' as const,
        title: t,
        subjectId,
        when: when(),
      });
      results.push(
        ...(await Promise.all([
          addEvent(db, a, mk(`A${i}`), 'web'),
          addEvent(db, b, mk(`B${i}`), 'web'),
        ])),
      );
    }
    expect(results.every((r) => r.ok)).toBe(true);
    const [e] = await db.select({ n: count() }).from(events);
    const [a] = await db
      .select({ n: count() })
      .from(adminAudit)
      .where(eq(adminAudit.action, 'event.add'));
    expect(e.n).toBe(10);
    expect(a.n).toBe(10);
  });
});

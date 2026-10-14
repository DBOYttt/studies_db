import {
  consumeLoginToken,
  type Db,
  insertMaterial,
  setBanned,
  subjects,
  topics,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { PermissionFlagsBits } from 'discord.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { commandDefinitions } from '../src/commands/definitions.js';
import { planStatusText, planSyncReply } from '../src/commands/plan.js';
import { replyOptions } from '../src/commands/reply.js';
import { linkFor, searchReply } from '../src/commands/student.js';

let db: Db;

beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('plan', () => {
  it('planStatusText: never, ok, error', () => {
    const now = new Date();
    const none = {
      requestedAt: null,
      lastRunAt: null,
      lastOkAt: null,
      lastError: null,
      stats: null,
    };
    expect(planStatusText(none, now)).toBe('Nigdy nie synchronizowano.');
    const ok = {
      ...none,
      lastOkAt: new Date('2026-10-12T10:30:00Z'),
      stats: { created: 3, updated: 2, deleted: 1, unchanged: 9, warnings: [] },
    };
    expect(planStatusText(ok, now)).toBe(
      'Ostatnia synchronizacja: 12.10.2026, 12:30 (+3 ~2 -1)',
    );
    expect(planStatusText({ ...ok, lastError: 'boom' }, now)).toBe(
      'Ostatnia synchronizacja: 12.10.2026, 12:30 (+3 ~2 -1)\nBłąd: boom',
    );
    expect(planStatusText({ ...none, lastError: 'boom' }, now)).toBe(
      'Nigdy nie synchronizowano.\nBłąd: boom',
    );
  });

  it('plan sync requests and reports status', async () => {
    expect(await planSyncReply(db, new Date())).toBe(
      'Zlecono synchronizację planu (wykona ją worker w ciągu minuty).\nNigdy nie synchronizowano.',
    );
  });
});

describe('link and ban', () => {
  const user = { discordUserId: 'u1', displayName: 'Ann', avatarUrl: null };
  it('returns a consumable url', async () => {
    const r = await linkFor(db, 'https://x.pl', user);
    if (!r.ok) throw new Error('expected ok');
    const prefix = 'https://x.pl/auth/callback?token=';
    expect(r.url.startsWith(prefix)).toBe(true);
    expect(
      await consumeLoginToken(db, r.url.slice(prefix.length)),
    ).not.toBeNull();
  });
  it('appends an encoded next when given', async () => {
    const r = await linkFor(db, 'https://x.pl', user, '/admin');
    if (!r.ok) throw new Error('expected ok');
    expect(r.url.endsWith('&next=%2Fadmin')).toBe(true);
  });
  it('banned user is refused', async () => {
    await upsertUser(db, user);
    await setBanned(db, 'u1', true);
    expect(await linkFor(db, 'https://x.pl', user)).toEqual({
      ok: false,
      reason: 'banned',
    });
  });
});

describe('searchReply', () => {
  it('empty', async () => {
    expect(await searchReply(db, 'https://x.pl', 'abc')).toBe(
      'Brak wyników dla „abc”.',
    );
  });
  it('max 5 lines', async () => {
    const [s] = await db.insert(subjects).values({
      name: 'A',
      code: 'ALG',
      semester: 1,
      ects: 1,
      discordChannelId: 'c',
    });
    for (let i = 0; i < 7; i++) {
      const [t] = await db.insert(topics).values({
        subjectId: s.insertId,
        title: `Temat ${i}`,
        discordThreadId: `t${i}`,
      });
      const uploaderId = await upsertUser(db, {
        discordUserId: 'up',
        displayName: 'U',
        avatarUrl: null,
      });
      await insertMaterial(
        db,
        {
          topicId: t.insertId,
          uploaderId,
          discordMessageId: `m${i}`,
          discordAttachmentId: `a${i}`,
          originalFilename: `notatki${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1,
          sha256: 'a'.repeat(64),
          storagePath: `p${i}`,
          previewKind: 'none',
          extractedText: 'kolokwium z algebry',
        },
        [],
      );
    }
    const out = await searchReply(db, 'https://x.pl', 'kolokwium');
    const lines = out.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(
      /^\*\*ALG\*\* · Temat \d — notatki\d\.pdf https:\/\/x\.pl\/topics\/\d+$/,
    );
  });
});

describe('escaping and mentions', () => {
  it('escapes markdown in the echoed query', async () => {
    expect(await searchReply(db, 'https://x.pl', '@everyone *x*')).toBe(
      'Brak wyników dla „@everyone \\*x\\*”.',
    );
  });
  it('replyOptions never allows mentions', () => {
    expect(replyOptions('@everyone').allowedMentions.parse).toEqual([]);
    expect(replyOptions('x', true).flags).toBeDefined();
  });
});

describe('commandDefinitions', () => {
  it('has unique top-level names including all 12', () => {
    const names = commandDefinitions.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of [
      'subject',
      'lecturer',
      'ban',
      'unban',
      'resync',
      'link',
      'panel',
      'search',
      'class',
      'plan',
      'setup',
      'admin',
    ])
      expect(names).toContain(n);
  });

  it('sets max_length on free-text options', () => {
    type Opt = { name: string; max_length?: number; options?: Opt[] };
    const find = (cmd: string, sub: string, opt: string) => {
      const c = commandDefinitions.find((x) => x.name === cmd) as unknown as {
        options: Opt[];
      };
      return c.options
        .find((o) => o.name === sub)
        ?.options?.find((o) => o.name === opt)?.max_length;
    };
    expect(find('subject', 'add', 'code')).toBe(20);
    expect(find('subject', 'add', 'name')).toBe(200);
    expect(find('subject', 'add', 'description')).toBe(1000);
    expect(find('subject', 'edit', 'name')).toBe(200);
    expect(find('subject', 'edit', 'description')).toBe(1000);
    expect(find('lecturer', 'add', 'name')).toBe(200);
    expect(find('lecturer', 'add', 'title')).toBe(50);
    expect(find('lecturer', 'add', 'email')).toBe(200);
  });

  it('lecturer assign takes class choices and optional group 1-99', () => {
    type Opt = {
      name: string;
      required?: boolean;
      min_value?: number;
      max_value?: number;
      choices?: { name: string; value: string }[];
      options?: Opt[];
    };
    const c = commandDefinitions.find(
      (x) => x.name === 'lecturer',
    ) as unknown as {
      options: Opt[];
    };
    const opts = c.options.find((o) => o.name === 'assign')?.options ?? [];
    expect(opts.find((o) => o.name === 'role')).toBeUndefined();
    const cls = opts.find((o) => o.name === 'class');
    expect(cls?.required).toBe(true);
    expect(cls?.choices).toEqual([
      { name: 'Wykład', value: 'wyklad' },
      { name: 'Laboratorium', value: 'laboratorium' },
      { name: 'Ćwiczenia', value: 'cwiczenia' },
      { name: 'Projekt', value: 'projekt' },
      { name: 'Seminarium', value: 'seminarium' },
      { name: 'Zajęcia praktyczne', value: 'praktyczne' },
      { name: 'WF', value: 'wf' },
    ]);
    const g = opts.find((o) => o.name === 'group');
    expect(g?.required).toBeFalsy();
    expect(g?.min_value).toBe(1);
    expect(g?.max_value).toBe(99);
  });

  it('defines new subcommands and options', () => {
    type Opt = {
      name: string;
      autocomplete?: boolean;
      choices?: unknown[];
      options?: Opt[];
    };
    const sub = (cmd: string, s: string) =>
      (
        commandDefinitions.find((x) => x.name === cmd) as unknown as {
          options: Opt[];
        }
      ).options.find((o) => o.name === s)?.options ?? [];
    const names = (o: Opt[]) => o.map((x) => x.name);
    expect(names(sub('subject', 'edit'))).toContain('platform_url');
    expect(names(sub('lecturer', 'add'))).toEqual(
      expect.arrayContaining(['office_hours', 'room']),
    );
    expect(names(sub('lecturer', 'edit'))).toEqual([
      'lecturer',
      'name',
      'title',
      'email',
      'office_hours',
      'room',
    ]);
    expect(sub('lecturer', 'edit')[0]?.autocomplete).toBe(true);
    expect(names(sub('class', 'edit'))).toEqual([
      'subject',
      'kind',
      'assessment',
      'note',
      'platform_url',
    ]);
    expect(sub('class', 'edit')[0]?.autocomplete).toBe(true);
    expect(sub('class', 'edit')[1]?.choices).toHaveLength(7);
    expect(sub('class', 'edit')[2]?.choices).toHaveLength(6);
    const plan = commandDefinitions.find(
      (x) => x.name === 'plan',
    ) as unknown as {
      options: Opt[];
    };
    expect(names(plan.options)).toEqual(['sync', 'status']);
  });

  it('restricts admin commands by default permissions only', () => {
    const perms = (n: string) =>
      commandDefinitions.find((c) => c.name === n)?.default_member_permissions;
    for (const n of [
      'subject',
      'lecturer',
      'class',
      'plan',
      'ban',
      'unban',
      'resync',
      'admin',
    ])
      expect(perms(n)).toBe(String(PermissionFlagsBits.ManageGuild));
    for (const n of ['link', 'panel', 'search']) expect(perms(n)).toBeFalsy();
  });
});

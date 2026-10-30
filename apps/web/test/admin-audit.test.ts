import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  type AuditAction,
  auditActionLabel,
  auditDetails,
  auditHref,
  auditStatementPreview,
  eventTargetLabel,
  formatAuditTime,
  parseAuditQuery,
  parseAuditTarget,
} from '../lib/admin-audit';

describe('parseAuditQuery', () => {
  it('defaults to page 1 without filters', () => {
    expect(parseAuditQuery({})).toEqual({ page: 1 });
  });
  it('reads user, action and page', () => {
    expect(
      parseAuditQuery({ user: '3', action: 'sql.rejected', page: '4' }),
    ).toEqual({ page: 4, userId: 3, action: 'sql.rejected' });
  });
  it('reads the Admins filter', () => {
    expect(parseAuditQuery({ who: 'admins' })).toEqual({
      page: 1,
      adminsOnly: true,
    });
    expect(parseAuditQuery({ who: 'x' })).toEqual({ page: 1 });
    // the User select's "Admins only" option
    expect(parseAuditQuery({ user: 'admins' })).toEqual({
      page: 1,
      adminsOnly: true,
    });
    expect(auditHref({ page: 2, adminsOnly: true })).toBe(
      '/admin/audit?who=admins&page=2',
    );
  });
  it('ignores invalid values', () => {
    expect(parseAuditQuery({ user: 'x', action: 'drop', page: '-2' })).toEqual({
      page: 1,
    });
    expect(parseAuditQuery({ user: ['1', '2'], page: '1.5' })).toEqual({
      page: 1,
    });
  });
});

describe('auditHref', () => {
  it('keeps filters and omits page 1', () => {
    expect(auditHref({ page: 1 })).toBe('/admin/audit');
    expect(auditHref({ page: 2, userId: 3, action: 'sql.execute' })).toBe(
      '/admin/audit?user=3&action=sql.execute&page=2',
    );
  });
});

describe('formatAuditTime', () => {
  it('formats in Europe/Warsaw with the zone', () => {
    // 2026-01-15 11:05:09 UTC = 12:05:09 in Warsaw (CET)
    expect(formatAuditTime(new Date(Date.UTC(2026, 0, 15, 11, 5, 9)))).toBe(
      '15 Jan 2026, 12:05:09 CET',
    );
    // summer time (CEST, UTC+2)
    expect(formatAuditTime(new Date(Date.UTC(2026, 6, 1, 22, 0, 0)))).toBe(
      '2 Jul 2026, 00:00:00 CEST',
    );
    // September is "Sep", not the en-GB "Sept"
    expect(formatAuditTime(new Date(Date.UTC(2026, 8, 7, 8, 0, 0)))).toBe(
      '7 Sep 2026, 10:00:00 CEST',
    );
  });
});

describe('auditStatementPreview', () => {
  it('keeps short statements on one line', () => {
    expect(auditStatementPreview('UPDATE t\n  SET a = 1')).toBe(
      'UPDATE t SET a = 1',
    );
  });
  it('cuts to 120 characters', () => {
    const s = auditStatementPreview(`SELECT ${'x'.repeat(300)}`);
    expect(s).toHaveLength(120);
    expect(s.endsWith('…')).toBe(true);
  });
  it('handles null', () => {
    expect(auditStatementPreview(null)).toBe('');
  });
});

it('pages by 50', () => {
  expect(AUDIT_PAGE_SIZE).toBe(50);
});

describe('auditActionLabel', () => {
  it('names every action the apps write, in plain words', () => {
    expect(auditActionLabel('sql.execute')).toBe('SQL executed');
    expect(auditActionLabel('class_mark.add')).toBe('Entry quiz turned on');
    expect(auditActionLabel('class_mark.remove')).toBe('Entry quiz turned off');
    expect(auditActionLabel('class_mark.skip')).toBe(
      'Entry quiz: not this week',
    );
    expect(auditActionLabel('event.add')).toBe('Event added');
    expect(auditActionLabel('user.ban')).toBe('Access blocked');
    for (const a of [
      'sql.rejected',
      'class_mark.edit',
      'class_mark.restore',
      'class_mark.unskip',
      'event.edit',
      'event.delete',
      'event.restore',
      'event.link',
      'event.unlink',
      'event.upload',
      'event.upload_retry',
      'event.post_retry',
      'user.unban',
      'reminders.update',
      'bot.setup',
      'bot.setup_dry_run',
      'bot.resync',
      'plan.sync',
      'subject.add',
      'subject.edit',
      'class.edit',
      'lecturer.add',
      'lecturer.edit',
      'lecturer.assign',
    ])
      expect(auditActionLabel(a), a).not.toBe(a);
  });
  it('falls back to the raw key for an unknown action', () => {
    expect(auditActionLabel('x.y')).toBe('x.y');
  });
});

describe('parseAuditTarget', () => {
  it('reads events, series and entry quizzes', () => {
    expect(parseAuditTarget('event.add', '14')).toEqual({
      type: 'event',
      id: 14,
    });
    expect(parseAuditTarget('event.edit', 'series:3')).toEqual({
      type: 'series',
      id: 3,
    });
    expect(parseAuditTarget('event.post_retry', 'event:5')).toEqual({
      type: 'event',
      id: 5,
    });
    expect(parseAuditTarget('class_mark.add', 'class_mark:3')).toEqual({
      type: 'class_mark',
      id: 3,
    });
  });
  it('reads subject codes of subject, class and lecturer actions', () => {
    for (const a of [
      'subject.add',
      'subject.edit',
      'class.edit',
      'lecturer.assign',
      'lecturer.unassign',
    ])
      expect(parseAuditTarget(a, 'ASD'), a).toEqual({
        type: 'subject',
        code: 'ASD',
      });
  });
  it('leaves other targets alone', () => {
    expect(parseAuditTarget('sql.execute', 'subjects')).toBeNull();
    expect(parseAuditTarget('reminders.update', '7')).toBeNull();
    expect(parseAuditTarget('lecturer.edit', '7')).toBeNull();
    expect(parseAuditTarget('event.add', null)).toBeNull();
    expect(parseAuditTarget('event.add', 'x')).toBeNull();
  });
});

describe('eventTargetLabel', () => {
  it('reads as kind: title subject, day month (wall time)', () => {
    expect(
      eventTargetLabel({
        kind: 'kolokwium',
        title: 'Kolokwium 1',
        subjectCode: 'ASD',
        startsAt: new Date(Date.UTC(2026, 9, 26, 23, 30)),
      }),
    ).toBe('Test: Kolokwium 1 ASD, 26 Oct');
    expect(
      eventTargetLabel({
        kind: 'wyjazd',
        title: 'Wyjazd',
        subjectCode: null,
        startsAt: new Date(Date.UTC(2026, 8, 3, 8)),
      }),
    ).toBe('Trip: Wyjazd, 3 Sep');
  });
});

describe('auditDetails', () => {
  it('shows the statement of SQL rows', () => {
    expect(
      auditDetails({
        action: 'sql.execute',
        statement: 'UPDATE t\n SET a = 1',
        details: null,
      }),
    ).toBe('UPDATE t SET a = 1');
  });
  it('sums up the details of other rows', () => {
    expect(
      auditDetails({
        action: 'event.edit',
        statement: null,
        details: { source: 'web', changes: { title: {}, startsAt: {} } },
      }),
    ).toBe('changed: title, start · via the website');
    expect(
      auditDetails({
        action: 'class_mark.add',
        statement: null,
        details: { source: 'discord' },
      }),
    ).toBe('via Discord');
    expect(
      auditDetails({ action: 'plan.sync', statement: null, details: null }),
    ).toBe('');
  });
});

describe('audit filter options for the web admin actions', () => {
  const NEW = {
    'subject.add': 'Subject added',
    'subject.edit': 'Subject changed',
    'class.edit': 'Class changed',
    'lecturer.add': 'Lecturer added',
    'lecturer.edit': 'Lecturer changed',
    'lecturer.assign': 'Lecturer assigned',
    'lecturer.unassign': 'Lecturer unassigned',
    'user.ban': 'Access blocked',
    'user.unban': 'Access unblocked',
    'plan.sync': 'Timetable sync requested',
    'bot.request': 'Bot request queued',
    'bot.request_cancel': 'Bot request cancelled',
    'bot.setup': 'Server set up',
    'bot.setup_dry_run': 'Server setup previewed',
    'bot.resync': 'Resync',
  } as const;
  it('lists each one with its label, after the SQL ones', () => {
    expect(AUDIT_ACTIONS.slice(0, 2)).toEqual(['sql.execute', 'sql.rejected']);
    for (const [a, label] of Object.entries(NEW)) {
      expect(AUDIT_ACTIONS, a).toContain(a);
      expect(AUDIT_ACTION_LABELS[a as AuditAction], a).toBe(label);
      expect(auditActionLabel(a)).toBe(label);
    }
    expect(AUDIT_ACTIONS).toHaveLength(2 + Object.keys(NEW).length);
  });
  it('accepts them as ?action= filters', () => {
    expect(parseAuditQuery({ action: 'bot.request' })).toEqual({
      page: 1,
      action: 'bot.request',
    });
    expect(auditHref({ page: 1, action: 'lecturer.assign' })).toBe(
      '/admin/audit?action=lecturer.assign',
    );
  });
});

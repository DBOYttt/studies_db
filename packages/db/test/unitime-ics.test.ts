import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  expandOccurrences,
  type IcsEvent,
  parseIcs,
  utcToWarsawWall,
} from '../src/unitime/index.js';

const text = readFileSync(
  new URL('./fixtures/unitime.ics', import.meta.url),
  'utf8',
);
const cal = parseIcs(text);
const byUid = (uid: string) => {
  const ev = cal.events.find((e) => e.uid === uid);
  if (!ev) throw new Error(`no event ${uid}`);
  return ev;
};
const wall = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

describe('parseIcs', () => {
  it('reads the calendar name and every VEVENT (ignoring VTIMEZONE)', () => {
    expect(cal.name).toBe('O-TPR-1 S1 harmonogram dla Semestr zimowy 2026');
    const count = (text.match(/^BEGIN:VEVENT\r?$/gm) ?? []).length;
    expect(count).toBeGreaterThan(20);
    expect(cal.events).toHaveLength(count);
  });

  it('decodes escaped description lines and commas', () => {
    const ev = cal.events.find((e) => e.description.startsWith('CWL 5c'));
    expect(ev?.description).toBe('CWL 5c\ndr hab. inż. Malinowski, P');
  });

  it('parses quoted CN containing a comma and the mailto address', () => {
    const ev = cal.events.find((e) => e.description.startsWith('CWL 5c'));
    expect(ev?.organizer).toEqual({
      cn: 'dr hab. inż. Malinowski, P',
      email: expect.stringMatching(/^lecturer\d+@example\.edu$/),
    });
  });

  it('unfolds folded lines', () => {
    const ev = byUid('900000003');
    expect(ev.summary).toBe(
      'Bardzo długi tytuł przedmiotu służący do sprawdzenia łamania linii w pliku iCalendar zgodnie z RFC 5545',
    );
  });

  it('handles LF-only input and tab folding', () => {
    const lf =
      'BEGIN:VCALENDAR\nX-WR-CALNAME:A\nBEGIN:VEVENT\nUID:1\nSUMMARY:ab\n\tcd\nDTSTART;TZID=Europe/Warsaw:20261006T164500\nDTEND;TZID=Europe/Warsaw:20261006T181500\nEND:VEVENT\nEND:VCALENDAR\n';
    const c = parseIcs(lf);
    expect(c.events[0].summary).toBe('abcd');
    expect(c.events[0].status).toBe('confirmed');
    expect(c.events[0].organizer).toBeNull();
    expect(c.events[0].start).toEqual(wall(2026, 10, 6, 16, 45));
  });

  it('parses status and sequence', () => {
    expect(byUid('900000001').status).toBe('cancelled');
    expect(byUid('900000002').status).toBe('confirmed');
    expect(byUid('2145955391').sequence).toBe(1);
  });

  it('keeps TZID wall times as-is', () => {
    const ev = byUid('2145955391');
    expect(ev.start).toEqual(wall(2026, 10, 6, 16, 45));
    expect(ev.end).toEqual(wall(2026, 10, 6, 18, 15));
    expect(ev.rrule).toBeNull();
    expect(ev.rruleUnsupported).toBe(false);
  });

  it('parses the weekly Hala rule and its exdates', () => {
    const ev = byUid('2119893282');
    expect(ev.rrule?.byDay).toEqual([5]);
    expect(ev.rrule?.until).toEqual(wall(2027, 1, 22, 9, 30));
    expect(ev.exdates).toContainEqual(wall(2026, 12, 25, 8, 0));
    expect(ev.exdates).toContainEqual(wall(2027, 1, 1, 8, 0));
  });

  it('parses multi-day BYDAY', () => {
    const ev = cal.events.find((e) => e.rrule && e.rrule.byDay.length === 3);
    expect(ev?.rrule?.byDay).toEqual([2, 3, 4]);
  });
});

describe('utcToWarsawWall', () => {
  it('applies CET and CEST', () => {
    expect(utcToWarsawWall(new Date(Date.UTC(2027, 0, 22, 8, 30)))).toEqual(
      wall(2027, 1, 22, 9, 30),
    );
    expect(utcToWarsawWall(new Date(Date.UTC(2026, 9, 2, 6, 0)))).toEqual(
      wall(2026, 10, 2, 8, 0),
    );
  });
});

describe('expandOccurrences', () => {
  it('expands the Friday WF event around the DST change', () => {
    const occ = expandOccurrences(byUid('2119893282'));
    const fridays: Date[] = [];
    for (
      let d = wall(2026, 10, 2, 8);
      d <= wall(2027, 1, 22, 8);
      d = new Date(d.getTime() + 7 * 864e5)
    )
      fridays.push(d);
    const skip = [
      wall(2026, 12, 25, 8).getTime(),
      wall(2027, 1, 1, 8).getTime(),
    ];
    const expected = fridays.filter((d) => !skip.includes(d.getTime()));
    expect(occ.map((o) => o.start)).toEqual(expected);
    expect(occ).toHaveLength(15);
    for (const o of occ) {
      expect(o.start.getUTCHours()).toBe(8);
      expect(o.start.getUTCMinutes()).toBe(0);
      expect(o.end.getTime() - o.start.getTime()).toBe(90 * 60000);
    }
    expect(
      occ.some((o) => o.start.getTime() === wall(2026, 10, 23, 8).getTime()),
    ).toBe(true);
    expect(
      occ.some((o) => o.start.getTime() === wall(2026, 10, 30, 8).getTime()),
    ).toBe(true);
  });

  it('expands a multi-day rule in date order', () => {
    const ev = cal.events.find(
      (e) => e.rrule && e.rrule.byDay.length === 3,
    ) as IcsEvent;
    const occ = expandOccurrences(ev);
    const times = occ.map((o) => o.start.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(occ.map((o) => o.start.getUTCDay()))).toEqual(
      new Set([2, 3, 4]),
    );
  });

  it('returns a non-recurring event as itself', () => {
    const ev = byUid('2145955391');
    expect(expandOccurrences(ev)).toEqual([{ start: ev.start, end: ev.end }]);
  });

  it('marks FREQ=DAILY unsupported and expands once', () => {
    const c = parseIcs(
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:d\r\nDTSTART;TZID=Europe/Warsaw:20261006T164500\r\nDTEND;TZID=Europe/Warsaw:20261006T181500\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    );
    const ev = c.events[0];
    expect(ev.rrule).toBeNull();
    expect(ev.rruleUnsupported).toBe(true);
    expect(expandOccurrences(ev)).toHaveLength(1);
  });

  it('treats weekly without UNTIL as unsupported', () => {
    const c = parseIcs(
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:w\r\nDTSTART;TZID=Europe/Warsaw:20261006T164500\r\nDTEND;TZID=Europe/Warsaw:20261006T181500\r\nRRULE:FREQ=WEEKLY;BYDAY=TU\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    );
    expect(c.events[0].rruleUnsupported).toBe(true);
    expect(c.events[0].rrule).toBeNull();
  });
});

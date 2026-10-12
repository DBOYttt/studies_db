/**
 * Minimal iCalendar (RFC 5545) reader for UniTime exports. Pure: no DB access.
 * "Wall time" values are `Date`s whose UTC fields equal the Europe/Warsaw wall clock.
 */

export type WallTime = Date;

export interface IcsEvent {
  uid: string;
  sequence: number;
  status: 'confirmed' | 'cancelled';
  summary: string;
  description: string;
  location: string;
  organizer: { cn: string; email: string | null } | null;
  start: WallTime;
  end: WallTime;
  rrule: { until: WallTime | null; byDay: number[] } | null;
  rruleUnsupported: boolean;
  exdates: WallTime[];
}

export interface IcsCalendar {
  name: string;
  events: IcsEvent[];
}

const DAY_MS = 86_400_000;
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const warsawFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Converts a real UTC instant to the Europe/Warsaw wall clock (as a wall Date). */
export function utcToWarsawWall(utc: Date): WallTime {
  const p: Record<string, number> = {};
  for (const part of warsawFormat.formatToParts(utc)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return new Date(
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second),
  );
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

function parseLine(line: string): Prop | null {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let cur = '';
  inQuote = false;
  for (const c of head) {
    if (c === '"') inQuote = !inQuote;
    if (c === ';' && !inQuote) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    params[part.slice(0, eq).toUpperCase()] = part
      .slice(eq + 1)
      .replace(/^"(.*)"$/, '$1');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c: string) =>
    c === 'n' || c === 'N' ? '\n' : c,
  );
}

function parseDateValue(value: string): WallTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const d = new Date(
    Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)),
  );
  return m[7] ? utcToWarsawWall(d) : d;
}

function parseRrule(value: string): {
  rrule: IcsEvent['rrule'];
  unsupported: boolean;
} {
  const unsupported = { rrule: null, unsupported: true };
  const kv: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  if (kv.FREQ !== 'WEEKLY') return unsupported;
  if (kv.INTERVAL && kv.INTERVAL !== '1') return unsupported;
  if (kv.COUNT !== undefined || kv.UNTIL === undefined) return unsupported;
  for (const key of Object.keys(kv)) {
    if (!['FREQ', 'UNTIL', 'BYDAY', 'WKST', 'INTERVAL'].includes(key))
      return unsupported;
  }
  const until = parseDateValue(kv.UNTIL);
  if (!until) return unsupported;
  const byDay: number[] = [];
  if (kv.BYDAY) {
    for (const code of kv.BYDAY.split(',')) {
      const idx = DAY_CODES.indexOf(code.trim().toUpperCase());
      if (idx < 0) return unsupported;
      if (!byDay.includes(idx)) byDay.push(idx);
    }
  }
  return { rrule: { until, byDay }, unsupported: false };
}

export function parseIcs(text: string): IcsCalendar {
  const lines = unfold(text);
  let name = '';
  const events: IcsEvent[] = [];
  let cur: Prop[] | null = null;
  // Nested components (VTIMEZONE STANDARD/DAYLIGHT, VALARM) must not leak into events.
  let depth = 0;

  for (const line of lines) {
    if (!line) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      const comp = prop.value.toUpperCase();
      if (comp === 'VEVENT' && !cur) cur = [];
      else if (cur) depth++;
      else if (comp !== 'VCALENDAR') depth++;
      continue;
    }
    if (prop.name === 'END') {
      const comp = prop.value.toUpperCase();
      if (comp === 'VEVENT' && cur && depth === 0) {
        const ev = buildEvent(cur);
        if (ev) events.push(ev);
        cur = null;
      } else if (depth > 0) depth--;
      continue;
    }
    if (cur) {
      if (depth === 0) cur.push(prop);
    } else if (depth === 0 && prop.name === 'X-WR-CALNAME') {
      name = unescapeText(prop.value);
    }
  }
  return { name, events };
}

function buildEvent(props: Prop[]): IcsEvent | null {
  const first = (n: string) => props.find((p) => p.name === n);
  const start = first('DTSTART')
    ? parseDateValue(first('DTSTART')?.value ?? '')
    : null;
  if (!start) return null;
  const end =
    (first('DTEND') ? parseDateValue(first('DTEND')?.value ?? '') : null) ??
    start;
  const text = (n: string) => unescapeText(first(n)?.value ?? '');

  const orgProp = first('ORGANIZER');
  let organizer: IcsEvent['organizer'] = null;
  if (orgProp) {
    const mail = /^mailto:(.*)$/i.exec(orgProp.value.trim());
    organizer = {
      cn: unescapeText(orgProp.params.CN ?? ''),
      email: mail ? mail[1] : null,
    };
  }

  const rruleProp = first('RRULE');
  const parsed = rruleProp
    ? parseRrule(rruleProp.value)
    : { rrule: null, unsupported: false };

  const exdates: WallTime[] = [];
  for (const p of props.filter((q) => q.name === 'EXDATE')) {
    for (const v of p.value.split(',')) {
      const d = parseDateValue(v);
      if (d) exdates.push(d);
    }
  }

  return {
    uid: text('UID'),
    sequence: Number.parseInt(first('SEQUENCE')?.value ?? '0', 10) || 0,
    status:
      first('STATUS')?.value.trim().toUpperCase() === 'CANCELLED'
        ? 'cancelled'
        : 'confirmed',
    summary: text('SUMMARY'),
    description: text('DESCRIPTION'),
    location: text('LOCATION'),
    organizer,
    start,
    end,
    rrule: parsed.rrule,
    rruleUnsupported: parsed.unsupported,
    exdates,
  };
}

/** Expands a (weekly) event into its occurrences, in wall time. Unsupported rules yield the first occurrence only. */
export function expandOccurrences(
  ev: IcsEvent,
): { start: WallTime; end: WallTime }[] {
  if (!ev.rrule) return [{ start: ev.start, end: ev.end }];
  const duration = ev.end.getTime() - ev.start.getTime();
  const byDay =
    ev.rrule.byDay.length > 0 ? [...ev.rrule.byDay] : [ev.start.getUTCDay()];
  // Weeks start on Monday (WKST=MO); offsets 0..6 = Mon..Sun.
  const offsets = byDay.map((d) => (d + 6) % 7).sort((a, b) => a - b);
  const startDay = Date.UTC(
    ev.start.getUTCFullYear(),
    ev.start.getUTCMonth(),
    ev.start.getUTCDate(),
  );
  const timeOfDay = ev.start.getTime() - startDay;
  const monday = startDay - ((ev.start.getUTCDay() + 6) % 7) * DAY_MS;
  const until = ev.rrule.until?.getTime() ?? Number.POSITIVE_INFINITY;
  const skip = new Set(ev.exdates.map((d) => d.getTime()));

  const out: { start: WallTime; end: WallTime }[] = [];
  for (let week = monday; week + timeOfDay <= until; week += 7 * DAY_MS) {
    for (const off of offsets) {
      const s = week + off * DAY_MS + timeOfDay;
      if (s < ev.start.getTime() || s > until || skip.has(s)) continue;
      out.push({ start: new Date(s), end: new Date(s + duration) });
    }
  }
  return out;
}

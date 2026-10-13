// The pinned "subject info" post /setup keeps in every forum.
import { ASSESSMENT_NAMES, CLASS_NAMES, groupName } from '@studies/db';
import type {
  ClassSpec,
  LecturerSpec,
  SessionSpec,
  SubjectSpec,
} from './types.js';

export const INFO_TITLE = 'ℹ️ Informacje o przedmiocie';
const MAX_MESSAGE = 2000;
const WEEKDAYS = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];

const hm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Monday-first sort key for a wall Date. */
const weekKey = (d: Date) =>
  ((d.getUTCDay() + 6) % 7) * 1440 + d.getUTCHours() * 60 + d.getUTCMinutes();

function lecturerLine(l: LecturerSpec): string {
  const who =
    [l.title, l.name].filter(Boolean).join(' ') +
    (l.group === null ? '' : ` (${groupName(l.group)})`);
  const contact = [
    l.email,
    l.officeHours && `konsultacje: ${l.officeHours}`,
    l.room && `pokój ${l.room}`,
  ].filter(Boolean);
  return `• ${who}${contact.length > 0 ? ` — ${contact.join(' · ')}` : ''}`;
}

function classBlock(c: ClassSpec): string {
  const assessment = c.assessment
    ? ` — ${ASSESSMENT_NAMES[c.assessment]}${c.assessmentNote ? ` (${c.assessmentNote})` : ''}`
    : '';
  return [
    `**${c.name}**${assessment}`,
    ...(c.platformUrl ? [c.platformUrl] : []),
    ...c.lecturers.map(lecturerLine),
  ].join('\n');
}

const sessionName = (s: SessionSpec) =>
  s.classKind
    ? `${CLASS_NAMES[s.classKind]}${s.group === null ? '' : ` ${groupName(s.group)}`}`
    : (s.label ?? 'Zajęcia');

function planBlock(sessions: SessionSpec[], webBaseUrl: string): string | null {
  if (sessions.length === 0) return null;
  const firstOfSeries = new Map<string, SessionSpec>();
  for (const s of [...sessions].sort((a, b) => +a.startsAt - +b.startsAt)) {
    if (s.status === 'confirmed' && !firstOfSeries.has(s.uid)) {
      firstOfSeries.set(s.uid, s);
    }
  }
  const slots = [...firstOfSeries.values()]
    .sort((a, b) => weekKey(a.startsAt) - weekKey(b.startsAt))
    .map(
      (s) =>
        `${WEEKDAYS[s.startsAt.getUTCDay()]} ${hm(s.startsAt)}–${hm(s.endsAt)} · ${sessionName(s)}${s.room ? ` · ${s.room}` : ''}`,
    );
  const cancelled = sessions
    .filter((s) => s.status === 'cancelled')
    .sort((a, b) => +a.startsAt - +b.startsAt)
    .map((s) => `odwołane: ${ymd(s.startsAt)} ${sessionName(s)}`);
  return [
    '**Plan zajęć**',
    ...slots,
    ...cancelled,
    `Pełny plan: ${webBaseUrl}/s/plan`,
  ].join('\n');
}

export function renderInfoPost(s: SubjectSpec, webBaseUrl: string): string {
  const subjectUrl = `${webBaseUrl}/s/subjects/${encodeURIComponent(s.code)}`;
  const head = [
    `**${s.name}** (${s.code}) — Semestr ${s.semester}, ${s.ects} ECTS`,
    ...(s.platformUrl ? [`Platforma: ${s.platformUrl}`] : []),
    `Strona: ${subjectUrl}`,
  ].join('\n');
  const plan = planBlock(s.sessions ?? [], webBaseUrl);
  const text = [
    head,
    ...s.classes.map(classBlock),
    ...(plan ? [plan] : []),
  ].join('\n\n');
  if (text.length <= MAX_MESSAGE) return text;
  const more = `\n…\nWięcej: ${subjectUrl}`;
  return text.slice(0, MAX_MESSAGE - more.length) + more;
}

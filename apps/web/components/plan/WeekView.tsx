'use client';

import { Funnel, Plus } from '@phosphor-icons/react';
import {
  CLASS_KINDS,
  CLASS_NAMES,
  type ClassKind,
  EVENT_KINDS,
} from '@studies/db/constants';
import Link from 'next/link';
import {
  type CSSProperties,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DAY_END_MIN,
  DAY_START_MIN,
  filterMyGroups,
  hiddenByMyGroups,
  type IsoWeek,
  type MyGroups,
  type PlanSession,
  SLOT_MIN,
  slotRange,
} from '@/lib/plan';
import { dayColumns, eventPageHref, sessionKey } from '@/lib/plan-events';
import {
  dayHeader,
  fromWeekSession,
  type SessionLinks,
  type WeekSession,
  wallTime,
  weekHeading,
} from '@/lib/plan-view';
import { SessionPanel } from './SessionPanel';

const EMPTY_GROUPS: MyGroups = {};

/** Height of one 15-minute grid row (px). */
const ROW = 14;
const SLOTS = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN;
const HOUR_PX = (60 / SLOT_MIN) * ROW;
const GRID_H = SLOTS * ROW;
const HOURS = Array.from(
  { length: (DAY_END_MIN - DAY_START_MIN) / 60 + 1 },
  (_, i) => DAY_START_MIN / 60 + i,
);
const GUTTER = 48;
const DAY_MIN_W = 128;

const navBtn =
  'inline-flex items-center gap-1 rounded border border-line-strong bg-panel px-2.5 py-[5px] text-accent-ink hover:border-accent hover:text-accent-ink-hover';

type Session = PlanSession & { links: SessionLinks };

export interface WeekViewProps {
  week: IsoWeek;
  /** Wall midnights (ISO strings) of the shown days, Monday first. */
  days: string[];
  /** Sessions starting in the week; dates as ISO strings of wall Dates. */
  sessions: WeekSession[];
  /** Precomputed links: previous week, the current week, next week. */
  nav: { prev: string; today: string; next: string };
  /** Wall date `YYYY-MM-DD` of today (highlighted when shown). */
  today: string | null;
  /** Apply the stored "Moje grupy" choice (only on /plan). */
  myGroupsFilter: boolean;
  /** The user's saved "Moje grupy" (already sanitized by the server). */
  myGroups?: MyGroups;
  /** Simple view: the session panel hides the SQL link. */
  simple?: boolean;
  /** Link of the "+ Wydarzenie" button (the event form, prefilled). */
  newEventHref?: string;
}

const kindStyle = (k: ClassKind | null): CSSProperties =>
  k
    ? ({
        '--k-bg': `var(--kind-${k}-bg)`,
        '--k-fg': `var(--kind-${k}-fg)`,
      } as CSSProperties)
    : ({
        '--k-bg': 'var(--surface)',
        '--k-fg': 'var(--faint)',
      } as CSSProperties);

/**
 * Week timetable: days side by side, 07:00–20:00 in 15-minute rows,
 * overlapping sessions split the column (layoutDay). Blocks open
 * SessionPanel. Data and links come from the server (no function props), so
 * the subject and lecturer pages reuse it with `myGroupsFilter={false}`.
 */
export function WeekView({
  week,
  days: dayIsos,
  sessions: raw,
  nav,
  today,
  myGroupsFilter,
  myGroups = EMPTY_GROUPS,
  simple = false,
  newEventHref,
}: WeekViewProps) {
  const filterOn = myGroupsFilter && Object.keys(myGroups).length > 0;

  const all = useMemo(() => raw.map(fromWeekSession), [raw]);
  const shown = useMemo(
    () => (filterOn ? (filterMyGroups(all, myGroups) as Session[]) : all),
    [all, filterOn, myGroups],
  );
  const hidden = useMemo(
    () => (filterOn ? hiddenByMyGroups(all, myGroups) : 0),
    [all, filterOn, myGroups],
  );
  const days = useMemo(() => dayIsos.map((d) => new Date(d)), [dayIsos]);
  const columns = useMemo(() => dayColumns(days, shown), [days, shown]);
  const hasAllDay = columns.some((c) => c.allDay.length > 0);
  const hasEvents = shown.some((s) => s.type === 'event');
  const kinds = useMemo(() => {
    const used = new Set(
      shown.filter((s) => s.type === 'class').map((s) => s.classKind),
    );
    return CLASS_KINDS.filter((k) => used.has(k));
  }, [shown]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = shown.find((s) => sessionKey(s) === selectedId) ?? null;
  const blockRefs = useRef(new Map<string, HTMLButtonElement>());
  const close = useCallback(() => {
    setSelectedId((id) => {
      if (id !== null) blockRefs.current.get(id)?.focus();
      return null;
    });
  }, []);

  const heading = weekHeading(week, days);

  return (
    <section aria-label="Plan tygodnia" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="m-0 text-base font-semibold tracking-[-0.01em]">
          {heading}
        </h2>
        <nav aria-label="Tygodnie" className="flex items-center gap-1.5">
          <Link href={nav.prev} className={navBtn} scroll={false}>
            ‹ Poprzedni
          </Link>
          <Link href={nav.today} className={navBtn} scroll={false}>
            Dziś
          </Link>
          <Link href={nav.next} className={navBtn} scroll={false}>
            Następny ›
          </Link>
          {newEventHref && (
            <Link
              href={newEventHref}
              className="ml-1 inline-flex items-center gap-1 rounded bg-accent-fill px-2.5 py-[5px] font-semibold text-on-accent hover:bg-accent-fill-hover active:translate-y-px"
            >
              <Plus size={13} weight="bold" aria-hidden />
              Wydarzenie
            </Link>
          )}
        </nav>
      </div>

      {filterOn && (
        <div className="flex items-center gap-1.5 self-start rounded-md border border-line-strong bg-box-head px-2.5 py-1">
          <Funnel size={14} className="text-accent-ink" aria-hidden />
          <span>Filtr: Moje grupy</span>
          <Link
            href="/plan?tab=groups"
            className="text-accent-ink hover:text-accent-ink-hover hover:underline"
          >
            zmień
          </Link>
          {hidden > 0 && (
            <Link
              href="/plan?tab=groups"
              className="ml-1 text-muted hover:underline"
            >
              Ukryte zajęcia: {hidden} — uzupełnij Moje grupy
            </Link>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-md border border-line-strong bg-zebra px-4 py-10 text-center text-muted">
          Brak zajęć w tym tygodniu.
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <div className="overflow-x-auto rounded-md border border-line-strong bg-page">
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `${GUTTER}px repeat(${columns.length}, minmax(${DAY_MIN_W}px, 1fr))`,
                  minWidth: GUTTER + columns.length * DAY_MIN_W,
                }}
              >
                <div className="sticky left-0 z-[2] border-b border-line-strong bg-surface" />
                {columns.map(({ key, day }) => {
                  const h = dayHeader(day);
                  const isToday = key === today;
                  return (
                    <div
                      key={key}
                      className={`flex items-baseline gap-1.5 border-b border-l border-line-strong border-l-line px-2 py-[7px] ${
                        isToday ? 'bg-selected' : 'bg-surface'
                      }`}
                    >
                      <span className="font-semibold">{h.name}</span>
                      <span
                        className={`font-mono text-xs ${isToday ? 'text-accent-ink' : 'text-muted'}`}
                      >
                        {h.date}
                      </span>
                      {isToday && <span className="sr-only">(dziś)</span>}
                    </div>
                  );
                })}

                {hasAllDay && (
                  <>
                    <div className="sticky left-0 z-[2] border-b border-line-strong bg-surface px-1.5 py-1 text-right text-[10px] leading-[14px] text-faint">
                      cały dzień
                    </div>
                    {columns.map(({ key, allDay }) => (
                      <ul
                        key={key}
                        aria-label="Wydarzenia całodniowe"
                        className="m-0 flex list-none flex-col gap-0.5 border-b border-l border-line-strong border-l-line bg-surface p-[3px]"
                      >
                        {allDay.map((s) => (
                          <li key={sessionKey(s)} className="flex min-w-0">
                            <EventBlock s={s} simple={simple} strip />
                          </li>
                        ))}
                      </ul>
                    ))}
                  </>
                )}

                <div
                  className="sticky left-0 z-[2] bg-page"
                  style={{ height: GRID_H }}
                  aria-hidden
                >
                  {HOURS.map((h, i) => (
                    <span
                      key={h}
                      className={`absolute right-1.5 font-mono text-[11px] leading-none text-faint ${
                        i === HOURS.length - 1 ? '-translate-y-full' : ''
                      }`}
                      style={{
                        top: i * HOUR_PX + (i === HOURS.length - 1 ? -2 : 3),
                      }}
                    >
                      {String(h).padStart(2, '0')}:00
                    </span>
                  ))}
                </div>
                {columns.map(({ key, blocks }) => (
                  <div
                    key={key}
                    className={`relative border-l border-line ${key === today ? 'bg-list-hover/40' : ''}`}
                    style={{
                      height: GRID_H,
                      backgroundImage:
                        'linear-gradient(var(--border) 1px, transparent 1px)',
                      backgroundSize: `100% ${HOUR_PX}px`,
                    }}
                  >
                    {blocks.map(({ session: s, col, cols }) =>
                      s.type === 'event' ? (
                        <EventBlock
                          key={sessionKey(s)}
                          s={s}
                          simple={simple}
                          col={col}
                          cols={cols}
                        />
                      ) : (
                        <Block
                          key={sessionKey(s)}
                          s={s}
                          col={col}
                          cols={cols}
                          selected={sessionKey(s) === selectedId}
                          onOpen={() => setSelectedId(sessionKey(s))}
                          refMap={blockRefs.current}
                        />
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>
            {(kinds.length > 0 || hasEvents) && (
              <ul
                aria-label="Rodzaje zajęć"
                className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"
              >
                {kinds.map((k) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 rounded-sm border-l-[3px] border-[var(--k-fg)] bg-[var(--k-bg)]"
                      style={kindStyle(k)}
                    />
                    {CLASS_NAMES[k]}
                  </li>
                ))}
                {hasEvents && (
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 rounded-sm border-[1.5px] border-accent-ink bg-page"
                    />
                    Wydarzenia
                  </li>
                )}
              </ul>
            )}
          </div>
          {selected && (
            <div className="lg:sticky lg:top-12 lg:w-[340px] lg:shrink-0">
              <SessionPanel
                session={selected}
                onClose={close}
                simple={simple}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Block({
  s,
  col,
  cols,
  selected,
  onOpen,
  refMap,
}: {
  s: Session;
  col: number;
  cols: number;
  selected: boolean;
  onOpen: () => void;
  refMap: Map<string, HTMLButtonElement>;
}) {
  const { from, to } = slotRange(s);
  const cancelled = s.status === 'cancelled';
  const time = `${wallTime(s.startsAt)}–${wallTime(s.endsAt)}`;
  const classLine = [s.className, s.groupName].filter(Boolean).join(' ');
  const title = [
    `${time} ${s.subjectName}`,
    classLine,
    s.room,
    s.lecturerName,
    cancelled ? 'Odwołane' : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <button
      type="button"
      data-testid="plan-block"
      ref={(el) => {
        if (el) refMap.set(sessionKey(s), el);
        else refMap.delete(sessionKey(s));
      }}
      onClick={onOpen}
      aria-pressed={selected}
      title={title}
      className={`absolute flex flex-col overflow-hidden rounded border-l-[3px] border-[var(--k-fg)] bg-[var(--k-bg)] px-[5px] py-[3px] text-left text-[11px] leading-[14px] text-fg hover:shadow-[inset_0_0_0_1px_var(--k-fg)] ${
        selected
          ? 'z-[1] shadow-[inset_0_0_0_1px_var(--k-fg)] outline-2 outline-accent'
          : ''
      } ${cancelled ? 'opacity-75' : ''}`}
      style={{
        ...kindStyle(s.classKind),
        top: from * ROW + 1,
        height: (to - from) * ROW - 2,
        left: `calc(${(col / cols) * 100}% + 2px)`,
        width: `calc(${100 / cols}% - 4px)`,
      }}
    >
      <span className="sr-only">{time} </span>
      <span
        className={`truncate font-semibold text-[var(--k-fg)] ${cancelled ? 'line-through' : ''}`}
      >
        {s.subjectCode || s.subjectName}
      </span>
      {cancelled && (
        <span className="truncate font-semibold text-err-fg">Odwołane</span>
      )}
      {classLine && (
        <span className={`truncate ${cancelled ? 'line-through' : ''}`}>
          {classLine}
        </span>
      )}
      {s.room && <span className="truncate text-muted">{s.room}</span>}
      {s.lecturerName && (
        <span className="truncate text-muted">{s.lecturerName}</span>
      )}
    </button>
  );
}

/** Event: outlined (no fill), kind symbol + title; links to the event page. */
function EventBlock({
  s,
  simple,
  col = 0,
  cols = 1,
  strip = false,
}: {
  s: Session;
  simple: boolean;
  col?: number;
  cols?: number;
  strip?: boolean;
}) {
  const kind = s.eventKind ? EVENT_KINDS[s.eventKind] : null;
  const title = s.eventTitle ?? s.label;
  const time = s.allDay ? 'cały dzień' : wallTime(s.startsAt);
  const tip = [`${time} ${title}`, kind?.label, s.subjectName, s.room]
    .filter(Boolean)
    .join('\n');
  const pos: CSSProperties = strip
    ? {}
    : (() => {
        const { from, to } = slotRange(s);
        return {
          top: from * ROW + 1,
          height: (to - from) * ROW - 2,
          left: `calc(${(col / cols) * 100}% + 2px)`,
          width: `calc(${100 / cols}% - 4px)`,
        };
      })();
  return (
    <Link
      href={eventPageHref(s.id, simple)}
      data-testid="plan-event"
      title={tip}
      className={`flex min-w-0 overflow-hidden rounded border-[1.5px] border-accent-ink bg-page px-[5px] text-[11px] leading-[14px] text-fg hover:bg-list-hover ${
        strip ? 'flex-1 items-center gap-1 py-px' : 'absolute flex-col py-[2px]'
      }`}
      style={pos}
    >
      <span className="sr-only">{time} </span>
      <span className="truncate font-semibold">
        <span aria-hidden>{kind?.symbol} </span>
        {title}
      </span>
      {!strip && s.subjectCode && (
        <span className="truncate text-muted">{s.subjectCode}</span>
      )}
      {!strip && s.room && (
        <span className="truncate text-muted">{s.room}</span>
      )}
    </Link>
  );
}

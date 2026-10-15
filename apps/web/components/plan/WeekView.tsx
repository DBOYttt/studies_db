'use client';

import { Funnel } from '@phosphor-icons/react';
import {
  CLASS_KINDS,
  CLASS_NAMES,
  type ClassKind,
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
  type IsoWeek,
  layoutDay,
  type MyGroups,
  type PlanSession,
  SLOT_MIN,
  slotRange,
} from '@/lib/plan';
import {
  dayHeader,
  fromWeekSession,
  type SessionLinks,
  type WeekSession,
  wallDateKey,
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
}: WeekViewProps) {
  const filterOn = myGroupsFilter && Object.keys(myGroups).length > 0;

  const all = useMemo(() => raw.map(fromWeekSession), [raw]);
  const shown = useMemo(
    () => (filterOn ? (filterMyGroups(all, myGroups) as Session[]) : all),
    [all, filterOn, myGroups],
  );
  const days = useMemo(() => dayIsos.map((d) => new Date(d)), [dayIsos]);
  const columns = useMemo(
    () =>
      days.map((d) => {
        const key = wallDateKey(d);
        return {
          key,
          day: d,
          blocks: layoutDay(
            shown.filter((s) => wallDateKey(s.startsAt) === key),
          ) as { session: Session; col: number; cols: number }[],
        };
      }),
    [days, shown],
  );
  const kinds = useMemo(() => {
    const used = new Set(shown.map((s) => s.classKind));
    return CLASS_KINDS.filter((k) => used.has(k));
  }, [shown]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = shown.find((s) => s.id === selectedId) ?? null;
  const blockRefs = useRef(new Map<number, HTMLButtonElement>());
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
                    {blocks.map(({ session: s, col, cols }) => (
                      <Block
                        key={s.id}
                        s={s}
                        col={col}
                        cols={cols}
                        selected={s.id === selectedId}
                        onOpen={() => setSelectedId(s.id)}
                        refMap={blockRefs.current}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {kinds.length > 0 && (
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
  refMap: Map<number, HTMLButtonElement>;
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
        if (el) refMap.set(s.id, el);
        else refMap.delete(s.id);
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

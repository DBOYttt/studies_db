'use client';

import { CaretRight, Funnel, Plus } from '@phosphor-icons/react';
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
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DAY_END_MIN,
  DAY_START_MIN,
  filterMyGroups,
  type IsoWeek,
  type MyGroups,
  type PlanBadge,
  type PlanSession,
  SLOT_MIN,
  slotRange,
} from '@/lib/plan';
import { dayColumns, eventPageHref, sessionKey } from '@/lib/plan-events';
import {
  type BadgeLayout,
  badgeBarText,
  badgeLayout,
  badgePadBottom,
  badgeTitle,
  blockKind,
  dayHeader,
  entryQuizEditHref,
  fromWeekSession,
  hiddenNote,
  mergedBarText,
  myGroupsHref,
  type SessionLinks,
  showAllGroupsPrompt,
  unpickedHidden,
  type WeekSession,
  wallDateKey,
  wallTime,
  weekHeading,
} from '@/lib/plan-view';
import { blockDayPrefix } from '@/lib/status-text';
import { EntryQuizBadge } from './EntryQuizBadge';
import { type QuizBadge, SessionPanel } from './SessionPanel';

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
/** Minimum day column width (px); narrower weeks scroll sideways. */
const DAY_MIN = 128;
/** id of the session panel (aria-controls of the bars that open it). */
const PANEL_ID = 'session-panel';

const navBtn =
  'inline-flex items-center gap-1 rounded border border-line-strong bg-panel px-2.5 py-[5px] text-accent-ink hover:border-accent hover:text-accent-ink-hover';

type Session = PlanSession & { links: SessionLinks };

/** An entry quiz just skipped on a session: the panel offers its Undo. */
type RecentSkip = { key: string; badge: QuizBadge };
type OnSkipped = (key: string, badge: QuizBadge) => void;

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
  /** Apply the stored "My groups" choice (only on /plan). */
  myGroupsFilter: boolean;
  /** The user's saved "My groups" (already sanitized by the server). */
  myGroups?: MyGroups;
  /** Simple view: the session panel hides the SQL link. */
  simple?: boolean;
  /** Link of the "+ Add event" button (the event form, prefilled). */
  newEventHref?: string;
}

const EXAM_STYLE = {
  '--k-bg': 'var(--exam-bg)',
  '--k-fg': 'var(--exam-fg)',
} as CSSProperties;

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
  // Only the sessions hidden for want of a pick are worth a note; the other
  // groups of a picked class are hidden on purpose.
  const hidden = useMemo(
    () => (filterOn ? unpickedHidden(all, myGroups) : null),
    [all, filterOn, myGroups],
  );
  const allGroups =
    myGroupsFilter && !filterOn && showAllGroupsPrompt(all, myGroups);
  const groupsHref = myGroupsHref(simple);
  const days = useMemo(() => dayIsos.map((d) => new Date(d)), [dayIsos]);
  const columns = useMemo(() => dayColumns(days, shown), [days, shown]);
  const hasAllDay = columns.some((c) => c.allDay.length > 0);
  const hasEvents = shown.some((s) => blockKind(s) === 'event');
  const hasExams = shown.some((s) => blockKind(s) === 'exam');
  const hasTests = shown.some((s) => s.badges?.some((b) => b.kind === 'test'));
  const hasQuizzes = shown.some((s) =>
    s.badges?.some((b) => b.kind === 'entry_quiz'),
  );
  const kinds = useMemo(() => {
    const used = new Set(
      shown.filter((s) => blockKind(s) === 'class').map((s) => s.classKind),
    );
    return CLASS_KINDS.filter((k) => used.has(k));
  }, [shown]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = shown.find((s) => sessionKey(s) === selectedId) ?? null;
  const blockRefs = useRef(new Map<string, HTMLButtonElement>());
  const scrollerRef = useRef<HTMLDivElement>(null);
  /*
   * From lg the panel slides over the grid (the grid keeps its width), on
   * the side away from the selected block so the block stays in view.
   */
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('right');
  useLayoutEffect(() => {
    if (selectedId === null) return;
    const b = blockRefs.current.get(selectedId)?.getBoundingClientRect();
    const g = scrollerRef.current?.getBoundingClientRect();
    if (!b || !g) return;
    setPanelSide(
      b.left + b.width / 2 > g.left + g.width / 2 ? 'left' : 'right',
    );
  }, [selectedId]);
  const [recentSkip, setRecentSkip] = useState<RecentSkip | null>(null);
  const close = useCallback(() => {
    setRecentSkip(null);
    setSelectedId((id) => {
      if (id !== null) blockRefs.current.get(id)?.focus();
      return null;
    });
  }, []);
  // A skip from a bar or the panel opens the panel with its Undo.
  const onSkipped = useCallback<OnSkipped>((key, badge) => {
    setRecentSkip({ key, badge });
    setSelectedId(key);
  }, []);
  const onUndone = useCallback(() => setRecentSkip(null), []);

  const heading = weekHeading(week, days);
  // Day headers name the day columns (role="group") for screen readers.
  const dayId = `${useId()}-day`;

  return (
    <section aria-label="Week timetable" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="m-0 text-base font-semibold tracking-[-0.01em]">
          {heading}
        </h2>
        <nav aria-label="Weeks" className="flex items-center gap-1.5">
          <Link href={nav.prev} className={navBtn} scroll={false}>
            ‹ Previous
          </Link>
          <Link href={nav.today} className={navBtn} scroll={false}>
            Today
          </Link>
          <Link href={nav.next} className={navBtn} scroll={false}>
            Next ›
          </Link>
          {newEventHref && (
            <Link
              href={newEventHref}
              className="ml-1 inline-flex items-center gap-1 rounded bg-accent-fill px-2.5 py-[5px] font-semibold text-on-accent hover:bg-accent-fill-hover active:translate-y-px"
            >
              <Plus size={13} weight="bold" aria-hidden />
              Add event
            </Link>
          )}
        </nav>
      </div>

      {filterOn && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 self-start rounded-md border border-line-strong bg-box-head px-2.5 py-1">
          <Funnel size={14} className="text-accent-ink" aria-hidden />
          <span>Filter: My groups</span>
          <Link
            href={groupsHref}
            className="text-accent-ink hover:text-accent-ink-hover hover:underline"
          >
            change
          </Link>
          {hidden && hidden.count > 0 && (
            <Link href={groupsHref} className="ml-1 text-muted hover:underline">
              {hiddenNote(hidden)}
            </Link>
          )}
        </div>
      )}
      {allGroups && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 self-start rounded-md border border-line-strong bg-box-head px-2.5 py-1">
          <Funnel size={14} className="text-accent-ink" aria-hidden />
          <span>Showing all groups.</span>
          <Link
            href={groupsHref}
            className="text-accent-ink hover:text-accent-ink-hover hover:underline"
          >
            Pick yours
          </Link>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-md border border-line-strong bg-zebra px-4 py-10 text-center text-muted">
          No classes this week.
        </div>
      ) : (
        <div className="relative flex flex-col gap-4">
          <div className="min-w-0">
            {/* relative: the sr-only "(today)" must not escape the scroller. */}
            <div
              ref={scrollerRef}
              data-testid="plan-scroller"
              className="relative overflow-x-auto rounded-md border border-line-strong bg-page"
            >
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `${GUTTER}px repeat(${columns.length}, minmax(${DAY_MIN}px, 1fr))`,
                  minWidth: GUTTER + columns.length * DAY_MIN,
                }}
              >
                <div className="sticky left-0 z-[2] border-b border-line-strong bg-surface" />
                {columns.map(({ key, day }) => {
                  const h = dayHeader(day);
                  const isToday = key === today;
                  return (
                    <div
                      key={key}
                      id={`${dayId}-${key}`}
                      data-testid="plan-day"
                      className={`relative flex items-baseline gap-1.5 border-b border-l border-line-strong border-l-line px-2 py-[7px] ${
                        isToday ? 'bg-selected' : 'bg-surface'
                      }`}
                    >
                      <span className="font-semibold">{h.name}</span>{' '}
                      <span
                        className={`font-mono text-xs ${isToday ? 'text-accent-ink' : 'text-muted'}`}
                      >
                        {h.date}
                      </span>
                      {isToday && <span className="sr-only">(today)</span>}
                    </div>
                  );
                })}

                {hasAllDay && (
                  <>
                    <div className="sticky left-0 z-[2] border-b border-line-strong bg-surface px-1.5 py-1 text-right text-[10px] leading-[14px] text-faint">
                      all day
                    </div>
                    {columns.map(({ key, day, allDay }) => (
                      <ul
                        key={key}
                        aria-label={`All-day events, ${dayHeader(day).name} ${dayHeader(day).date}`}
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
                  // biome-ignore lint/a11y/useSemanticElements: a fieldset would break the grid column; the group is named by its day header
                  <div
                    key={key}
                    role="group"
                    aria-labelledby={`${dayId}-${key}`}
                    className={`relative border-l border-line ${key === today ? 'bg-list-hover/40' : ''}`}
                    style={{
                      height: GRID_H,
                      backgroundImage:
                        'linear-gradient(var(--border) 1px, transparent 1px)',
                      backgroundSize: `100% ${HOUR_PX}px`,
                    }}
                  >
                    {blocks.map(({ session: s, col, cols }) =>
                      s.type === 'event' && blockKind(s) === 'exam' ? (
                        <ExamEventBlock
                          key={sessionKey(s)}
                          s={s}
                          simple={simple}
                          col={col}
                          cols={cols}
                        />
                      ) : s.type === 'event' ? (
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
                          onSkipped={onSkipped}
                          refMap={blockRefs.current}
                          simple={simple}
                        />
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>
            {(kinds.length > 0 || hasEvents || hasExams) && (
              <ul
                aria-label="Class types"
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
                {hasExams && (
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 rounded-sm border-l-[3px] border-[var(--k-fg)] bg-[var(--k-bg)]"
                      style={EXAM_STYLE}
                    />
                    Exam
                  </li>
                )}
                {hasEvents && (
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 rounded-sm border-[1.5px] border-accent-ink bg-page"
                    />
                    Events
                  </li>
                )}
                {hasTests && (
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-3 rounded-sm bg-muted"
                    />
                    Test
                  </li>
                )}
                {hasQuizzes && (
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-3 border-t-2 border-dashed border-muted"
                    />
                    Entry quiz
                  </li>
                )}
              </ul>
            )}
          </div>
          {selected && (
            // From lg: a 340 px slide-over above the grid and legend. The
            // full-height track lets clicks through; only the panel takes them.
            <div
              className={`lg:pointer-events-none lg:absolute lg:inset-y-0 lg:z-30 lg:w-[340px] ${
                panelSide === 'left' ? 'lg:left-0' : 'lg:right-0'
              }`}
            >
              <div className="lg:pointer-events-auto lg:sticky lg:top-12">
                <SessionPanel
                  key={sessionKey(selected)}
                  id={PANEL_ID}
                  session={selected}
                  onClose={close}
                  simple={simple}
                  skipped={
                    recentSkip?.key === sessionKey(selected)
                      ? recentSkip.badge
                      : null
                  }
                  onSkipped={(badge) => onSkipped(sessionKey(selected), badge)}
                  onUndone={onUndone}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Footer bars on a session block: the Test bar filled in the block's ink at
 * the very bottom, the Entry quiz bar above it, light with a dashed rule.
 * Each is a 24 px target and clips inside the block. The bar stack is a
 * size container: under 120 px the detail and caret go, under 92 px the
 * label shortens ("Quiz", "Test", "Q+T"); `aria-label`/`title` keep the
 * full text. On touch screens the bars are indicators and a tap opens the
 * session panel (larger targets) like the rest of the block.
 */
const barBase =
  'bar-in group flex h-6 w-full min-w-0 items-center gap-1.5 overflow-hidden px-1.5 text-left text-[11px] leading-none whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent @max-[92px]:gap-1 @max-[92px]:px-1';
const testBar = `${barBase} rounded-sm bg-[var(--k-fg)] text-[var(--k-bg)] hover:opacity-90`;
const quizBar = `${barBase} border-t border-dashed border-[var(--k-fg)] text-[var(--k-fg)] hover:bg-[color-mix(in_srgb,var(--k-fg)_12%,transparent)]`;
/** Quiz + Test in one bar: filled like a Test, dashed rule of the quiz. */
const mergedBar = `${testBar} border-t border-dashed border-[var(--k-bg)]`;

function BarText({
  label,
  short,
  detail,
}: {
  label: string;
  short: string;
  detail: string | null;
}) {
  const caps = 'text-[10px] font-bold uppercase';
  return (
    <>
      {/* The label stays whole; the detail truncates first. */}
      <span
        data-bar-label
        className={`${caps} shrink-0 tracking-[0.08em] @max-[92px]:hidden`}
      >
        {label}
      </span>
      <span
        data-bar-label
        className={`${caps} hidden min-w-0 truncate tracking-normal @max-[92px]:inline`}
      >
        {short}
      </span>
      {detail && (
        <span className="min-w-0 truncate font-medium @max-[120px]:hidden">
          {detail}
        </span>
      )}
      <CaretRight
        size={10}
        weight="bold"
        aria-hidden
        className="ml-auto shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 @max-[120px]:hidden"
      />
    </>
  );
}

/** Too short for bars: a 4 px stripe per badge (solid Test, dashed quiz). */
function BadgeStripe({ list }: { list: PlanBadge[] }) {
  return (
    <div
      aria-hidden
      data-testid="badge-stripe"
      className="pointer-events-none absolute inset-x-[3px] bottom-[2px] flex flex-col gap-px"
    >
      {list.map((b) =>
        b.kind === 'test' ? (
          <span key="test" className="h-1 rounded-sm bg-[var(--k-fg)]" />
        ) : (
          <span
            key="quiz"
            className="h-1 border-t-2 border-dashed border-[var(--k-fg)]"
          />
        ),
      )}
    </div>
  );
}

/** Entry quiz above, Test at the bottom edge. */
const barOrder = (list: PlanBadge[]) =>
  [...list].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === 'test' ? 1 : -1,
  );

function Badges({
  s,
  simple,
  layout,
  selected,
  onOpen,
  onSkipped,
}: {
  s: Session;
  simple: boolean;
  layout: BadgeLayout;
  selected: boolean;
  onOpen: () => void;
  onSkipped: OnSkipped;
}) {
  const list = barOrder(s.badges ?? []);
  if (list.length === 0 || layout === 'none') return null;
  if (layout === 'stripe') return <BadgeStripe list={list} />;
  const day = s.startsAt;
  const h = dayHeader(day);
  // Bars that open the panel say whether it is open.
  const opensPanel = {
    onClick: onOpen,
    'aria-expanded': selected,
    'aria-controls': selected ? PANEL_ID : undefined,
  };
  const stack =
    'absolute inset-x-[3px] bottom-[3px] z-[1] flex flex-col gap-0.5 @container pointer-coarse:pointer-events-none';
  if (layout === 'merged') {
    const m = mergedBarText(list);
    return (
      <div data-testid="badge-bars" className={stack}>
        <button
          type="button"
          {...opensPanel}
          title={m.title}
          aria-label={m.title}
          className={mergedBar}
        >
          <BarText label={m.label} short={m.short} detail={null} />
        </button>
      </div>
    );
  }
  return (
    <div data-testid="badge-bars" className={stack}>
      {list.map((b) =>
        b.kind === 'test' ? (
          b.eventIds.length === 1 ? (
            <Link
              key="test"
              href={eventPageHref(b.eventIds[0], simple)}
              title={badgeTitle(b)}
              aria-label={badgeTitle(b)}
              className={testBar}
            >
              <BarText {...badgeBarText(b)} />
            </Link>
          ) : (
            // Several tests: the session panel lists a link to each.
            <button
              key="test"
              type="button"
              {...opensPanel}
              title={badgeTitle(b)}
              aria-label={badgeTitle(b)}
              className={testBar}
            >
              <BarText {...badgeBarText(b)} />
            </button>
          )
        ) : (
          <EntryQuizBadge
            key="quiz"
            markId={b.markId}
            note={b.note}
            allGroups={b.allGroups}
            onDate={wallDateKey(day)}
            dateLabel={`${h.name} ${h.date}`}
            editHref={entryQuizEditHref(s.links)}
            label={badgeTitle(b)}
            onSkipped={() => onSkipped(sessionKey(s), b)}
            className={quizBar}
          >
            <BarText {...badgeBarText(b)} />
          </EntryQuizBadge>
        ),
      )}
    </div>
  );
}

function Block({
  s,
  col,
  cols,
  selected,
  onOpen,
  onSkipped,
  refMap,
  simple,
}: {
  s: Session;
  col: number;
  cols: number;
  selected: boolean;
  onOpen: () => void;
  onSkipped: OnSkipped;
  refMap: Map<string, HTMLButtonElement>;
  simple: boolean;
}) {
  const { from, to } = slotRange(s);
  const cancelled = s.status === 'cancelled';
  const exam = blockKind(s) === 'exam';
  const time = `${wallTime(s.startsAt)}–${wallTime(s.endsAt)}`;
  const classLine = [s.className, s.groupName].filter(Boolean).join(' ');
  const badgeCount = s.badges?.length ?? 0;
  const heightPx = (to - from) * ROW - 2;
  const layout = badgeLayout(heightPx, badgeCount);
  const title = [
    `${time} ${s.subjectName}`,
    exam ? 'Exam' : classLine,
    s.room,
    s.lecturerName,
    cancelled ? 'Cancelled' : null,
    ...(s.badges ?? []).map(badgeTitle),
  ]
    .filter(Boolean)
    .join('\n');
  const inner =
    'flex size-full flex-col overflow-hidden rounded-r px-[5px] pt-[3px] text-left';
  // Room for the bars or the stripe, plus a gap above them.
  const padBottom = badgePadBottom(layout, badgeCount);
  // Whole lines only: a half-cut line above the bars reads as noise.
  const textMax = Math.max(1, Math.floor((heightPx - 3 - padBottom) / 14)) * 14;
  // Lines keep their 14 px (shrink-0); the wrapper clips them above the
  // bars instead of letting them run on under the bars.
  const line = 'shrink-0 truncate';
  const body = (
    <span
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ maxHeight: textMax }}
    >
      <span className="sr-only">{blockDayPrefix(s.startsAt, time)}</span>
      <span
        data-block-line="subject"
        className={`${line} font-semibold text-[var(--k-fg)] ${cancelled ? 'line-through' : ''}`}
      >
        {s.subjectCode || s.subjectName}
      </span>
      {cancelled && (
        <span className={`${line} font-semibold text-err-fg`}>Cancelled</span>
      )}
      {exam ? (
        <span
          data-block-line="class"
          className={`${line} font-semibold text-[var(--k-fg)] ${cancelled ? 'line-through' : ''}`}
        >
          Exam{s.groupName ? ` · ${s.groupName}` : ''}
        </span>
      ) : (
        classLine && (
          <span
            data-block-line="class"
            lang="pl"
            className={`${line} ${cancelled ? 'line-through' : ''}`}
          >
            {classLine}
          </span>
        )
      )}
      {s.room && <span className={`${line} text-muted`}>{s.room}</span>}
      {s.lecturerName && (
        <span lang="pl" className={`${line} text-muted`}>
          {s.lecturerName}
        </span>
      )}
      {/* The stripe is decorative: name its badges for screen readers. */}
      {layout === 'stripe' && (
        <span className="sr-only">
          {` ${(s.badges ?? []).map(badgeTitle).join('. ')}`}
        </span>
      )}
    </span>
  );
  return (
    <div
      data-testid="plan-block"
      className={`absolute overflow-hidden rounded border-l-[3px] border-[var(--k-fg)] bg-[var(--k-bg)] text-[11px] leading-[14px] text-fg hover:shadow-[inset_0_0_0_1px_var(--k-fg)] ${
        selected
          ? 'z-[1] shadow-[inset_0_0_0_1px_var(--k-fg)] outline-2 outline-accent'
          : ''
      } ${cancelled ? 'opacity-75' : ''}`}
      style={{
        ...(exam ? EXAM_STYLE : kindStyle(s.classKind)),
        top: from * ROW + 1,
        height: (to - from) * ROW - 2,
        left: `calc(${(col / cols) * 100}% + 2px)`,
        width: `calc(${100 / cols}% - 4px)`,
      }}
    >
      {/* A merged exam opens the panel too; the panel links the event. */}
      <button
        type="button"
        data-block-main
        ref={(el) => {
          if (el) refMap.set(sessionKey(s), el);
          else refMap.delete(sessionKey(s));
        }}
        onClick={onOpen}
        aria-pressed={selected}
        title={title}
        className={inner}
        style={{ paddingBottom: padBottom }}
      >
        {body}
      </button>
      <Badges
        s={s}
        simple={simple}
        layout={layout}
        selected={selected}
        onOpen={onOpen}
        onSkipped={onSkipped}
      />
    </div>
  );
}

/** A timed egzamin event not merged into an imported exam: a filled exam block. */
function ExamEventBlock({
  s,
  simple,
  col,
  cols,
}: {
  s: Session;
  simple: boolean;
  col: number;
  cols: number;
}) {
  const { from, to } = slotRange(s);
  const title = s.eventTitle ?? s.label;
  const time = `${wallTime(s.startsAt)}–${wallTime(s.endsAt)}`;
  return (
    <Link
      href={eventPageHref(s.id, simple)}
      data-testid="plan-event"
      title={[`${time} ${title}`, 'Exam', s.subjectName, s.room]
        .filter(Boolean)
        .join('\n')}
      className="absolute flex flex-col overflow-hidden rounded border-l-[3px] border-[var(--k-fg)] bg-[var(--k-bg)] px-[5px] py-[3px] text-[11px] leading-[14px] text-fg hover:shadow-[inset_0_0_0_1px_var(--k-fg)]"
      style={{
        ...EXAM_STYLE,
        top: from * ROW + 1,
        height: (to - from) * ROW - 2,
        left: `calc(${(col / cols) * 100}% + 2px)`,
        width: `calc(${100 / cols}% - 4px)`,
      }}
    >
      <span className="sr-only">{blockDayPrefix(s.startsAt, time)}</span>
      <span className="truncate font-semibold text-[var(--k-fg)]">
        {s.subjectCode || title}
      </span>
      <span className="truncate font-semibold text-[var(--k-fg)]">Exam</span>
      <span lang="pl" className="truncate">
        {title}
      </span>
      {s.room && <span className="truncate text-muted">{s.room}</span>}
    </Link>
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
  const time = s.allDay ? 'all day' : wallTime(s.startsAt);
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
      <span className="sr-only">{blockDayPrefix(s.startsAt, time)}</span>
      <span className="truncate font-semibold">
        <span aria-hidden>{kind?.symbol} </span>
        <span lang="pl">{title}</span>
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

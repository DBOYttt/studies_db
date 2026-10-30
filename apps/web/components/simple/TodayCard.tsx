import { CLASS_NAMES } from '@studies/db/constants';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Bone, SkeletonRegion } from '@/components/Skeleton';
import type { PlanSession } from '@/lib/plan';
import { myGroupsHref, wallShortDate, wallTime } from '@/lib/plan-view';
import { chipHref } from '@/lib/simple';
import type { TodayClasses } from '@/lib/today';

const link = 'text-accent-ink hover:text-accent-ink-hover hover:underline';
const box = 'rounded-md border border-line-strong';

/** The kind swatch's colours: the timetable's class (or exam) colours. */
function swatch(s: PlanSession): CSSProperties {
  if (s.sessionKind === 'exam')
    return {
      '--k-bg': 'var(--exam-bg)',
      '--k-fg': 'var(--exam-fg)',
    } as CSSProperties;
  return (
    s.classKind
      ? {
          '--k-bg': `var(--kind-${s.classKind}-bg)`,
          '--k-fg': `var(--kind-${s.classKind}-fg)`,
        }
      : { '--k-bg': 'var(--surface)', '--k-fg': 'var(--faint)' }
  ) as CSSProperties;
}

/** "Wykład", "Ćwiczenia · Gr. 1" (Polish content), or "Exam". */
function kindText(s: PlanSession): { text: string; pl: boolean } {
  if (s.sessionKind === 'exam') return { text: 'Exam', pl: false };
  const kind = s.classKind
    ? CLASS_NAMES[s.classKind]
    : (s.className ?? s.label);
  return {
    text: [kind, s.groupName].filter(Boolean).join(' · '),
    pl: true,
  };
}

const subjectHref = (s: PlanSession) =>
  chipHref(
    s.subjectCode,
    { kind: null, group: null, tag: null },
    { kind: s.sessionKind === 'exam' ? null : s.classKind },
  );

function SessionRow({ s, withDay }: { s: PlanSession; withDay?: boolean }) {
  const cancelled = s.status === 'cancelled';
  const kind = kindText(s);
  return (
    <Link
      href={subjectHref(s)}
      className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2 hover:bg-list-hover sm:grid-cols-[auto_1fr_auto]"
    >
      <span
        className={`font-mono text-xs tabular-nums ${cancelled ? 'text-faint line-through' : 'text-accent-ink'}`}
      >
        {withDay && <>{wallShortDate(s.startsAt)}, </>}
        {wallTime(s.startsAt)}–{wallTime(s.endsAt)}
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span
          aria-hidden
          style={swatch(s)}
          className="inline-block h-2.5 w-2.5 shrink-0 self-center rounded-sm border-l-[3px] border-[var(--k-fg)] bg-[var(--k-bg)]"
        />
        <span
          lang="pl"
          className={`font-semibold ${cancelled ? 'text-faint line-through' : 'text-fg'}`}
        >
          {s.subjectName}
        </span>
        <span lang={kind.pl ? 'pl' : undefined} className="text-xs text-muted">
          {kind.text}
        </span>
        {cancelled && (
          <span className="rounded-full border border-err-fg px-2 text-xs text-err-fg">
            Cancelled
          </span>
        )}
      </span>
      {s.room && (
        <span className="col-start-2 text-xs text-muted sm:col-start-auto sm:text-right">
          <span className="sr-only">Room </span>
          {s.room}
        </span>
      )}
    </Link>
  );
}

/**
 * Start page card: today's classes (Warsaw day) under My groups, or every
 * group with a nudge to pick yours; on a day without classes, the next one.
 * `null` while loading: the heading stays, the list is a placeholder;
 * 'error' when the query failed (one muted line keeps the layout).
 */
export function TodayCard({ today }: { today: TodayClasses | 'error' | null }) {
  return (
    <section aria-labelledby="today-classes" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="today-classes" className="m-0 text-base font-semibold">
          Today
          {today && today !== 'error' && (
            <span className="ml-2 font-mono text-xs font-normal text-muted">
              {wallShortDate(today.day)}
            </span>
          )}
        </h2>
        <Link href="/s/plan" className={link}>
          Timetable
        </Link>
      </div>
      {today === null ? (
        <SkeletonRegion
          className={`${box} flex flex-col divide-y divide-line bg-panel`}
        >
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
              <Bone className="h-3 w-20" />
              <Bone className="h-4 w-48 max-w-[60%]" />
            </div>
          ))}
        </SkeletonRegion>
      ) : today === 'error' ? (
        <p className="m-0 text-[13px] text-muted">
          Could not load today's classes.
        </p>
      ) : (
        <TodayBody today={today} />
      )}
    </section>
  );
}

function TodayBody({ today }: { today: TodayClasses }) {
  const { sessions, next, groupsPicked } = today;
  return (
    <>
      {sessions.length > 0 ? (
        <ul
          aria-label="Today's classes"
          className={`${box} m-0 flex list-none flex-col divide-y divide-line bg-panel p-0`}
        >
          {sessions.map((s) => (
            <li key={s.id}>
              <SessionRow s={s} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={`${box} m-0 bg-zebra px-4 py-3 text-muted`}>
          No classes today.
        </p>
      )}
      {next && (
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-[13px] font-semibold text-muted">
            Next class
          </h3>
          <div className={`${box} bg-panel`}>
            <SessionRow s={next} withDay />
          </div>
        </div>
      )}
      {!groupsPicked && (
        <p className="m-0 text-[13px] text-muted">
          Showing all groups.{' '}
          <Link href={myGroupsHref(true)} className={link}>
            Pick your groups
          </Link>
        </p>
      )}
    </>
  );
}

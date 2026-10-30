import { ArrowSquareOut, Info } from '@phosphor-icons/react/dist/ssr';
import { MARK_NOTE_MAX } from '@studies/db';
import { CLASS_NAMES } from '@studies/db/constants';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EntryQuizSection } from '@/components/plan/EntryQuizSection';
import { FileList } from '@/components/simple/FileList';
import { type ChipRow, FilterChips } from '@/components/simple/FilterChips';
import { LecturerCards } from '@/components/simple/LecturerCards';
import { NextSessions } from '@/components/simple/NextSessions';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimplePreview } from '@/components/simple/SimplePreview';
import type { Crumb } from '@/components/simple/SimpleShell';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { cachedSubjectCards } from '@/lib/count-cache';
import { getDb, getViewsPool } from '@/lib/db';
import { loadEntryQuiz } from '@/lib/entry-quiz';
import { safeExternalUrl } from '@/lib/format';
import { loadSubject } from '@/lib/page-loaders';
import { subjectMetadata } from '@/lib/page-meta';
import { nowWall } from '@/lib/plan';
import { nextSessions } from '@/lib/plan-queries';
import { wallDateKey } from '@/lib/plan-view';
import {
  listSubjectClasses,
  listSubjectLecturers,
  listSubjectTags,
} from '@/lib/queries';
import { requireUser } from '@/lib/session';
import { chipHref, groupLecturers, parseSimpleFilters } from '@/lib/simple';
import { isoFiles, loadSimplePreview, navSubjects } from '@/lib/simple-page';
import { listSimpleFiles } from '@/lib/simple-queries';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  return subjectMetadata((await params).code);
}

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

/** Rows rendered at once; the heading still shows the full count. */
const MAX_FILES = 500;

export default async function SimpleSubject({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const [{ code: rawCode }, sp] = await Promise.all([params, searchParams]);
  const db = getDb();
  let code: string;
  try {
    code = decodeURIComponent(rawCode);
  } catch {
    notFound();
  }
  const subject = await loadSubject(code);
  if (!subject) notFound();
  const [cards, classes, tags, lecturerRows, upcoming] = await Promise.all([
    cachedSubjectCards(),
    listSubjectClasses(db, subject.id),
    listSubjectTags(db, subject.id),
    listSubjectLecturers(db, subject.id),
    // cancellations must not crowd out real classes: over-fetch, keep 3 confirmed
    nextSessions(getViewsPool(), subject.id, nowWall(), 10),
  ]);
  const sessions = upcoming.filter((s) => s.status !== 'cancelled').slice(0, 3);
  const lecturers = groupLecturers(lecturerRows);
  const cur = parseSimpleFilters(
    sp,
    classes.map((c) => c.kind),
    Object.fromEntries(
      classes.map((c) => [c.kind, c.groups.map((g) => g.number)]),
    ),
    tags.map((t) => t.id),
  );
  const cls = classes.find((c) => c.kind === cur.kind);
  const group = cls?.groups.find((g) => g.number === cur.group);
  const [list, preview, entryQuiz] = await Promise.all([
    listSimpleFiles(db, {
      subjectId: subject.id,
      kind: cur.kind ?? undefined,
      group: cur.group ?? undefined,
      tagId: cur.tag ?? undefined,
      limit: MAX_FILES,
    }),
    loadSimplePreview(db, sp, cards),
    // The selected class only (the timetable's "Edit" lands here), else all.
    loadEntryQuiz(db, cls ? [cls] : classes, {
      isAdmin: user.isAdmin,
      today: wallDateKey(nowWall()),
    }),
  ]);

  const href = (change: Parameters<typeof chipHref>[2]) =>
    chipHref(subject.code, cur, change);
  const baseHref = href({});
  const filtered = cur.kind !== null || cur.group !== null || cur.tag !== null;

  const rows: ChipRow[] = [
    {
      label: 'Class',
      chips: [
        { label: 'All', href: href({ kind: null }), active: !cur.kind },
        ...classes.map((c) => ({
          label: CLASS_NAMES[c.kind],
          href: href({ kind: c.kind }),
          active: cur.kind === c.kind,
        })),
      ],
    },
  ];
  if (cls && cls.groups.length > 0) {
    rows.push({
      label: 'Group',
      chips: [
        {
          label: 'All groups',
          href: href({ group: null }),
          active: cur.group === null,
        },
        ...cls.groups.map((g) => ({
          label: g.name,
          href: href({ group: g.number }),
          active: cur.group === g.number,
        })),
      ],
    });
  }
  rows.push({
    label: 'Type',
    chips: [
      { label: 'All', href: href({ tag: null }), active: !cur.tag },
      ...tags.map((t) => ({
        label: t.name,
        href: href({ tag: t.id }),
        active: cur.tag === t.id,
      })),
    ],
  });

  const subjectHref = href({ kind: null });
  const crumbs: Crumb[] = [
    { label: 'Start', href: '/s' },
    { label: subject.name, href: subjectHref },
  ];
  if (cls)
    crumbs.push({ label: CLASS_NAMES[cls.kind], href: href({ group: null }) });
  if (group) crumbs.push({ label: group.name });

  const platform = safeExternalUrl(subject.platformUrl);
  const advancedHref = `/mode?to=advanced&next=${encodeURIComponent(baseHref)}`;

  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'subject', code: subject.code }}
      crumbs={crumbs}
      user={user}
      adminEntry={user.isAdmin ? <SimpleAdminEntry /> : null}
      aside={
        preview && (
          <SimplePreview
            file={preview.file}
            closeHref={baseHref}
            meta={{ subjectName: preview.subjectName }}
          />
        )
      }
    >
      <div className="flex flex-col gap-1">
        <span className="self-start rounded bg-box-head px-1.5 py-0.5 font-mono text-xs font-semibold text-accent-ink">
          {subject.code}
        </span>
        <h1 className="mt-1 mb-0 text-[22px] font-semibold tracking-[-0.01em] text-balance">
          {subject.name}
        </h1>
        <p className="m-0 text-muted">
          Semester {subject.semester} · {subject.ects} ECTS
        </p>
        {subject.description && (
          <p className="mt-1 mb-0 max-w-[65ch] text-pretty whitespace-pre-line text-muted">
            {subject.description}
          </p>
        )}
        {platform && (
          <a
            href={platform}
            target="_blank"
            rel="noopener noreferrer"
            title={platform}
            className="mt-1 flex items-center gap-1 self-start text-[13px] text-accent-ink hover:text-accent-ink-hover hover:underline"
          >
            Subject platform
            <ArrowSquareOut size={14} aria-hidden />
          </a>
        )}
      </div>
      <FilterChips rows={rows} />
      <h2 className="mt-3 mb-0 text-base font-semibold">
        Files ({list.total})
      </h2>
      <FileList
        files={isoFiles(list.rows)}
        withSubject={false}
        selectedId={preview?.file.id ?? null}
        baseHref={baseHref}
        emptyText={
          filtered
            ? 'No files match the selected filters.'
            : 'No files in this subject.'
        }
        emptyAction={
          filtered
            ? {
                label: 'Clear filters',
                href: `/s/subjects/${encodeURIComponent(subject.code)}`,
              }
            : undefined
        }
      />
      {list.total > list.rows.length && (
        <p className="m-0 text-[13px] text-muted">
          Showing the newest {list.rows.length} of {list.total}. Narrow the
          filters to see older ones.
        </p>
      )}
      {sessions.length > 0 && <NextSessions sessions={sessions} />}
      {entryQuiz.length > 0 && (
        <EntryQuizSection
          classes={entryQuiz}
          defaultGroupId={group?.id ?? null}
          noteMax={MARK_NOTE_MAX}
        />
      )}
      {lecturers.length > 0 && (
        <>
          <h2 className="mt-3 mb-0 text-base font-semibold">Lecturers</h2>
          <LecturerCards lecturers={lecturers} />
        </>
      )}
      <p className="mt-2 mb-0 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
        <Info size={15} aria-hidden />
        <span>Need your own query?</span>
        <a href={advancedHref} className="link">
          Open this subject in advanced mode
        </a>
      </p>
    </SimpleShell>
  );
}

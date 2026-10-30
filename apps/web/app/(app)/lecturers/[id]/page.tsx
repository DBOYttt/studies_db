import {
  CalendarBlank,
  ChalkboardTeacher,
  Files,
  Stack,
} from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { EntityFilesGrid } from '@/components/EntityFilesGrid';
import { PlanWeekTab } from '@/components/plan/PlanWeekTab';
import { PlanWeekSkeleton } from '@/components/Skeleton';
import { ScreenHeader, type Tab } from '@/components/shell/ScreenHeader';
import { getViewsPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import {
  parseEntityGrid,
  parseEntityId,
  parseEntityTab,
} from '@/lib/entity-page';
import {
  type getLecturer,
  type LecturerAssignment,
  lecturerFiles,
  listLecturerAssignments,
} from '@/lib/entity-queries';
import { explorerHref } from '@/lib/explorer';
import { loadLecturer } from '@/lib/page-loaders';
import { lecturerMetadata } from '@/lib/page-meta';
import { requireUser } from '@/lib/session';
import { lecturerHref } from '@/lib/view-links';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return lecturerMetadata((await params).id);
}

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const TABS = ['classes', 'files', 'plan'] as const;

const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';
const th = 'border-b border-line-strong px-2.5 py-[7px] font-semibold';
const td = 'border-b border-line px-2.5 py-1';
const link =
  'font-medium text-accent-ink hover:text-accent-ink-hover hover:underline';

/** Lecturer page (spec section 2): Classes, Materials, Timetable. */
export default async function LecturerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  await requireUser();
  const id = parseEntityId((await params).id);
  if (id === null) notFound();
  const sp = await searchParams;
  const pool = getViewsPool();
  const base = lecturerHref(id);

  let lecturer: Awaited<ReturnType<typeof getLecturer>> = null;
  try {
    lecturer = await loadLecturer(id);
  } catch (err) {
    return (
      <>
        <ScreenHeader
          crumbs={[
            {
              icon: ChalkboardTeacher,
              kind: 'Lecturer:',
              label: `#${id}`,
              href: base,
            },
          ]}
        />
        <div role="alert" className={errBox}>
          Could not load the lecturer: {roErrorMessage(err)}
        </div>
      </>
    );
  }
  if (!lecturer) notFound();

  const tab = parseEntityTab(sp, TABS);
  const grid = parseEntityGrid(sp);
  const fullName = [lecturer.title, lecturer.name].filter(Boolean).join(' ');
  const tabs: Tab[] = [
    {
      label: 'Classes',
      icon: Stack,
      href: base,
      active: tab === 'classes',
    },
    {
      label: 'Materials',
      icon: Files,
      href: `${base}?tab=files`,
      active: tab === 'files',
    },
    {
      label: 'Timetable',
      icon: CalendarBlank,
      href: `${base}?tab=plan`,
      active: tab === 'plan',
    },
  ];

  return (
    <>
      <ScreenHeader
        crumbs={[
          {
            icon: ChalkboardTeacher,
            kind: 'Lecturer:',
            label: fullName,
            href: base,
          },
        ]}
        tabs={tabs}
      />
      <div className="flex flex-col gap-3.5">
        <div className="min-w-0">
          <h1
            lang="pl"
            className="m-0 text-xl font-semibold tracking-[-0.01em]"
          >
            {fullName}
          </h1>
          <p className="mt-0.5 font-mono text-xs text-muted">
            id {lecturer.id}
            {lecturer.email && (
              <>
                {', '}
                <a
                  href={`mailto:${lecturer.email}`}
                  className="text-accent-ink hover:text-accent-ink-hover hover:underline"
                >
                  {lecturer.email}
                </a>
              </>
            )}
          </p>
          {(lecturer.office_hours || lecturer.room) && (
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
              {lecturer.office_hours && (
                <>
                  <dt className="text-muted">Office hours:</dt>
                  <dd lang="pl" className="m-0 whitespace-pre-line">
                    {lecturer.office_hours}
                  </dd>
                </>
              )}
              {lecturer.room && (
                <>
                  <dt className="text-muted">Room:</dt>
                  <dd lang="pl" className="m-0">
                    {lecturer.room}
                  </dd>
                </>
              )}
            </dl>
          )}
        </div>
        {tab === 'classes' && <ClassesTab id={id} />}
        {tab === 'files' && (
          <EntityFilesGrid
            basePath={base}
            tab="files"
            grid={grid}
            load={() => lecturerFiles(pool, id, grid)}
            name={`lecturer-${id}-materials`}
          />
        )}
        {tab === 'plan' && (
          <Suspense fallback={<PlanWeekSkeleton />}>
            <PlanWeekTab
              week={sp.week}
              path={base}
              extra={{ tab: 'plan' }}
              filter={{ lecturerId: id }}
              myGroupsFilter={false}
            />
          </Suspense>
        )}
      </div>
    </>
  );
}

async function ClassesTab({ id }: { id: number }) {
  let rows: LecturerAssignment[] = [];
  try {
    rows = await listLecturerAssignments(getViewsPool(), id);
  } catch (err) {
    return (
      <div role="alert" className={errBox}>
        Could not load classes: {roErrorMessage(err)}
      </div>
    );
  }
  return (
    <div className="shrink-0 overflow-auto rounded-md border border-line-strong">
      <table
        aria-label="Lecturer classes"
        className="w-full min-w-[340px] border-collapse"
      >
        <thead>
          <tr className="bg-surface text-left">
            <th className={th}>Subject</th>
            <th className={th}>Class</th>
            <th className={th}>Group</th>
            <th className={`${th} text-right`}>Files</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const classUrl = explorerHref(r.subjectCode, {
              classKind: r.classKind,
            });
            // Groups listed under a whole-class row: indent, no repeated names.
            const underWhole =
              !r.wholeClass &&
              rows
                .slice(0, i)
                .some((p) => p.wholeClass && p.classId === r.classId);
            return (
              <tr
                key={`${r.classId}:${r.groupId ?? 'all'}`}
                className={`hover:bg-list-hover ${i % 2 ? 'bg-zebra' : ''}`}
              >
                <td className={td}>
                  {!underWhole && (
                    <Link
                      href={explorerHref(r.subjectCode, {})}
                      lang="pl"
                      className={link}
                    >
                      {r.subjectName}
                    </Link>
                  )}
                </td>
                <td className={td}>
                  {!underWhole && (
                    <Link href={classUrl} lang="pl" className={link}>
                      {r.className}
                    </Link>
                  )}
                </td>
                <td className={`${td} ${underWhole ? 'pl-6' : ''}`}>
                  {r.wholeClass ? (
                    <Link href={classUrl} className={link}>
                      All groups
                    </Link>
                  ) : (
                    <Link
                      href={explorerHref(r.subjectCode, {
                        classKind: r.classKind,
                        group: r.groupNumber,
                      })}
                      lang="pl"
                      className={link}
                    >
                      {r.groupName}
                    </Link>
                  )}
                </td>
                <td className={`${td} text-right font-mono`}>{r.fileCount}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="p-6 text-center text-muted">
                No classes assigned.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

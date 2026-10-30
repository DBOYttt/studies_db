import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ResultGrid } from '@/components/ResultGrid';
import { SemesterEmpty } from '@/components/SemesterEmpty';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import type { Cell } from '@/lib/cells';
import { getViewsPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { formatDate } from '@/lib/format';
import { currentMode } from '@/lib/mode';
import { currentSemester } from '@/lib/semester';
import { requireUser } from '@/lib/session';
import {
  querySubjectsGrid,
  SUBJECTS_COLUMNS,
  SUBJECTS_SQL,
  type SubjectGridRow,
} from '@/lib/subjects-grid';

export const metadata: Metadata = { title: 'Subjects' };

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  if ((await currentMode()) === 'simple') redirect('/s');
  const semester = await currentSemester(await searchParams);
  let subjects: SubjectGridRow[] = [];
  let error: string | null = null;
  try {
    subjects = await querySubjectsGrid(getViewsPool(), semester);
  } catch (err) {
    error = roErrorMessage(err);
  }
  const rows: Cell[][] = subjects.map((s) => [
    s.code,
    { text: s.name, href: `/subjects/${encodeURIComponent(s.code)}` },
    s.semester,
    s.ects,
    s.classes,
    s.files,
    s.latest
      ? { text: formatDate(s.latest), sort: s.latest.toISOString() }
      : null,
  ]);
  return (
    <>
      <ScreenHeader tabs={dbTabs('subjects')} />
      <h1 className="sr-only">Subjects</h1>
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg"
        >
          Could not load subjects: {error}
        </div>
      ) : (
        <>
          {subjects.length === 0 && (
            <div className="mb-3 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg">
              {semester === null ? (
                'No subjects. Run the bot sync.'
              ) : (
                <SemesterEmpty semester={semester} path="/" />
              )}
            </div>
          )}
          <ResultGrid
            columns={[...SUBJECTS_COLUMNS]}
            rows={rows}
            sql={SUBJECTS_SQL}
            name="subjects"
          />
        </>
      )}
    </>
  );
}

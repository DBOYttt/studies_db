import type { Cell } from '@/components/DataGrid';
import { ResultGrid } from '@/components/ResultGrid';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { listSubjectsOverview } from '@/lib/queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const COLUMNS = [
  'code',
  'name',
  'semester',
  'ects',
  'zajecia',
  'pliki',
  'ostatnio',
];

/** The design's `sqlBase` for the Przedmioty tab (shown and opened in the console). */
const SUBJECTS_SQL =
  'SELECT s.code, s.name, s.semester, s.ects,\n  GROUP_CONCAT(c.name) AS zajecia, COUNT(f.material_id) AS pliki,\n  MAX(f.created_at) AS ostatnio\nFROM `v_subjects` s\nLEFT JOIN `v_classes` c ON c.subject_id = s.id\nLEFT JOIN `v_files` f ON f.subject_code = s.code\nGROUP BY s.id';

export default async function Home() {
  await requireUser();
  const subjects = await listSubjectsOverview(getDb());
  const rows: Cell[][] = subjects.map((s) => {
    const classes = s.classes.filter((c) => c.kind !== 'none');
    return [
      s.code,
      { text: s.name, href: `/subjects/${encodeURIComponent(s.code)}` },
      s.semester,
      s.ects,
      classes.length ? classes.map((c) => c.name).join(', ') : null,
      s.materialCount,
      s.lastUploadAt
        ? {
            text: formatDate(s.lastUploadAt),
            sort: s.lastUploadAt.toISOString(),
          }
        : null,
    ];
  });
  return (
    <>
      <ScreenHeader tabs={dbTabs('subjects')} />
      <h1 className="sr-only">Przedmioty</h1>
      {subjects.length === 0 && (
        <div className="mb-3 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg">
          Brak przedmiotów. Uruchom synchronizację bota.
        </div>
      )}
      <ResultGrid
        columns={COLUMNS}
        rows={rows}
        sql={SUBJECTS_SQL}
        name="przedmioty"
      />
    </>
  );
}

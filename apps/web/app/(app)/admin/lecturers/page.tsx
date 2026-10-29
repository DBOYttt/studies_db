import { ChalkboardTeacher, Plus } from '@phosphor-icons/react/dist/ssr';
import { listLecturersAdmin } from '@studies/db';
import Link from 'next/link';
import { box, boxHead, link, td, th } from '@/components/admin/form-styles';
import { LecturerForm } from '@/components/admin/LecturerForm';
import { ADMIN_CRUMB, adminTabs } from '@/components/shell/admin-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

const empty = <span className="text-faint">—</span>;

/** /admin/lecturers: every lecturer, plus "Add lecturer". */
export default async function AdminLecturersPage() {
  await requireAdmin();
  const rows = await listLecturersAdmin(getDb());
  return (
    <>
      <ScreenHeader
        crumbs={[ADMIN_CRUMB, { label: 'Lecturers', href: '/admin/lecturers' }]}
        tabs={adminTabs('lecturers')}
      />
      <div className="flex max-w-[1200px] flex-col gap-4">
        <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">
          Lecturers
        </h1>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-labelledby="admin-lecturers-list" className={box}>
            <div className={boxHead}>
              <ChalkboardTeacher
                size={15}
                className="text-accent-ink"
                aria-hidden
              />
              <h2
                id="admin-lecturers-list"
                className="m-0 text-[13px] font-semibold"
              >
                All lecturers
              </h2>
              <span className="ml-auto font-mono text-[11px] text-faint">
                {rows.length}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="m-0 px-3 py-4 text-muted">
                No lecturers yet. Add the first one with the form.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Name</th>
                      <th className={th}>Title</th>
                      <th className={th}>Email</th>
                      <th className={th}>Room</th>
                      <th className={th}>Office hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l, i) => (
                      <tr
                        key={l.id}
                        className={`hover:bg-row-hover ${i % 2 ? 'bg-zebra' : ''}`}
                      >
                        <td className={td} lang="pl">
                          <Link
                            href={`/admin/lecturers/${l.id}`}
                            className={link}
                          >
                            {l.name}
                          </Link>
                        </td>
                        <td className={td} lang="pl">
                          {l.title ?? empty}
                        </td>
                        <td className={`${td} break-all`}>
                          {l.email ?? empty}
                        </td>
                        <td className={td}>{l.room ?? empty}</td>
                        <td className={`${td} max-w-[240px]`} lang="pl">
                          {l.officeHours ?? empty}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="admin-lecturer-add" className={box}>
            <div className={boxHead}>
              <Plus size={15} className="text-accent-ink" aria-hidden />
              <h2
                id="admin-lecturer-add"
                className="m-0 text-[13px] font-semibold"
              >
                Add lecturer
              </h2>
            </div>
            <LecturerForm />
          </section>
        </div>
      </div>
    </>
  );
}

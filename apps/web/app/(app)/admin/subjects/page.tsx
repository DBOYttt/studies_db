import { Books, Plus } from '@phosphor-icons/react/dist/ssr';
import { listSubjectsAdmin } from '@studies/db';
import Link from 'next/link';
import { box, boxHead, link, td, th } from '@/components/admin/form-styles';
import { SubjectForm } from '@/components/admin/SubjectForm';
import { ADMIN_CRUMB, adminTabs } from '@/components/shell/admin-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

const adminSubjectHref = (code: string) =>
  `/admin/subjects/${encodeURIComponent(code)}`;

/** /admin/subjects: every subject, plus "Add subject". */
export default async function AdminSubjectsPage() {
  await requireAdmin();
  const rows = await listSubjectsAdmin(getDb());
  return (
    <>
      <ScreenHeader
        crumbs={[ADMIN_CRUMB, { label: 'Subjects', href: '/admin/subjects' }]}
        tabs={adminTabs('subjects')}
      />
      <div className="flex max-w-[1200px] flex-col gap-4">
        <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">
          Subjects
        </h1>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-labelledby="admin-subjects-list" className={box}>
            <div className={boxHead}>
              <Books size={15} className="text-accent-ink" aria-hidden />
              <h2
                id="admin-subjects-list"
                className="m-0 text-[13px] font-semibold"
              >
                All subjects
              </h2>
              <span className="ml-auto font-mono text-[11px] text-faint">
                {rows.length}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="m-0 px-3 py-4 text-muted">
                No subjects yet. Add the first one with the form.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Code</th>
                      <th className={th}>Name</th>
                      <th className={`${th} text-right`}>Semester</th>
                      <th className={`${th} text-right`}>ECTS</th>
                      <th className={`${th} text-right`}>Classes</th>
                      <th className={th}>Forum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s, i) => (
                      <tr
                        key={s.id}
                        className={`hover:bg-row-hover ${i % 2 ? 'bg-zebra' : ''}`}
                      >
                        <td className={`${td} font-mono`}>
                          <Link
                            href={adminSubjectHref(s.code)}
                            className={link}
                          >
                            {s.code}
                          </Link>
                        </td>
                        <td className={td} lang="pl">
                          {s.name}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {s.semester}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {s.ects}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {s.classCount}
                        </td>
                        <td className={td}>
                          {s.forumLinked ? (
                            <span className="text-ok-fg">Linked</span>
                          ) : (
                            <span className="text-warn-fg">Not created</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="admin-subject-add" className={box}>
            <div className={boxHead}>
              <Plus size={15} className="text-accent-ink" aria-hidden />
              <h2
                id="admin-subject-add"
                className="m-0 text-[13px] font-semibold"
              >
                Add subject
              </h2>
            </div>
            <SubjectForm />
          </section>
        </div>
      </div>
    </>
  );
}

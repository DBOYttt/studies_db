import {
  ArrowSquareOut,
  ChalkboardTeacher,
  PencilSimpleLine,
} from '@phosphor-icons/react/dist/ssr';
import { getLecturerAdmin } from '@studies/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { box, boxHead, link } from '@/components/admin/form-styles';
import { LecturerForm } from '@/components/admin/LecturerForm';
import { ADMIN_CRUMB, adminTabs } from '@/components/shell/admin-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { lecturerLabel } from '@/lib/admin-pages';
import { getDb } from '@/lib/db';
import { parseEntityId } from '@/lib/entity-page';
import { requireAdmin } from '@/lib/session';
import { lecturerHref } from '@/lib/view-links';

export const dynamic = 'force-dynamic';

/** /admin/lecturers/[id]: the lecturer's edit form. */
export default async function AdminLecturerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const id = parseEntityId((await params).id);
  if (id === null) notFound();
  const lecturer = await getLecturerAdmin(getDb(), id);
  if (!lecturer) notFound();
  const name = lecturerLabel(lecturer);

  return (
    <>
      <ScreenHeader
        crumbs={[
          ADMIN_CRUMB,
          { label: 'Lecturers', href: '/admin/lecturers' },
          {
            icon: ChalkboardTeacher,
            label: name,
            href: `/admin/lecturers/${id}`,
          },
        ]}
        tabs={adminTabs('lecturers')}
      />
      <div className="flex max-w-[640px] flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1
            className="m-0 text-xl font-semibold tracking-[-0.01em]"
            lang="pl"
          >
            {name}
          </h1>
          <Link
            href={lecturerHref(id)}
            className={`${link} inline-flex items-center gap-1`}
          >
            Lecturer page
            <ArrowSquareOut size={13} aria-hidden />
          </Link>
        </div>
        <section aria-labelledby="admin-lecturer-edit" className={box}>
          <div className={boxHead}>
            <PencilSimpleLine
              size={15}
              className="text-accent-ink"
              aria-hidden
            />
            <h2
              id="admin-lecturer-edit"
              className="m-0 text-[13px] font-semibold"
            >
              Edit lecturer
            </h2>
          </div>
          <LecturerForm lecturer={lecturer} />
        </section>
      </div>
    </>
  );
}

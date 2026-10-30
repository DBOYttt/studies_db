import {
  ArrowSquareOut,
  BookOpenText,
  ChalkboardTeacher,
  PencilSimpleLine,
  UserPlus,
} from '@phosphor-icons/react/dist/ssr';
import { getSubjectAdmin, listLecturersAdmin } from '@studies/db';
import { CLASS_NAMES } from '@studies/db/constants';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton } from '@/components/admin/ActionButton';
import { AssignLecturerForm } from '@/components/admin/AssignLecturerForm';
import { CardStatus, CardStatusArea } from '@/components/admin/CardStatus';
import { ClassForm } from '@/components/admin/ClassForm';
import { box, boxHead, link } from '@/components/admin/form-styles';
import { SubjectForm } from '@/components/admin/SubjectForm';
import { ADMIN_CRUMB, adminTabs } from '@/components/shell/admin-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { unassignLecturerAction } from '@/lib/admin-actions';
import { lecturerLabel, parseSubjectParam } from '@/lib/admin-pages';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * /admin/subjects/[code]: the subject's edit form, then one card per class
 * (settings, lecturers with Remove, assign) and "Assign a lecturer" for any
 * class type.
 * The code resolves case-insensitively after trim; anything else is 404.
 */
export default async function AdminSubjectPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await requireAdmin();
  const code = parseSubjectParam((await params).code);
  if (code === null) notFound();
  const db = getDb();
  const [subject, lecturers] = await Promise.all([
    getSubjectAdmin(db, code),
    listLecturersAdmin(db),
  ]);
  if (!subject) notFound();
  const options = lecturers.map((l) => ({ id: l.id, label: lecturerLabel(l) }));
  const href = `/admin/subjects/${encodeURIComponent(subject.code)}`;

  return (
    <>
      <ScreenHeader
        crumbs={[
          ADMIN_CRUMB,
          { label: 'Subjects', href: '/admin/subjects' },
          { icon: BookOpenText, label: subject.code, href },
        ]}
        tabs={adminTabs('subjects')}
      />
      <div className="flex max-w-[1200px] flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">
            <span className="font-mono">{subject.code}</span>{' '}
            <span lang="pl">{subject.name}</span>
          </h1>
          <p className="m-0 text-muted">
            Semester {subject.semester} · {subject.ects} ECTS ·{' '}
            {subject.forumLinked ? (
              'forum linked'
            ) : (
              <>
                no forum yet,{' '}
                <Link href="/admin/sync" className={link}>
                  run setup
                </Link>
              </>
            )}
          </p>
          <Link
            href={`/subjects/${encodeURIComponent(subject.code)}`}
            className={`${link} inline-flex items-center gap-1`}
          >
            Subject page
            <ArrowSquareOut size={13} aria-hidden />
          </Link>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <section aria-labelledby="admin-subject-edit" className={box}>
              <div className={boxHead}>
                <PencilSimpleLine
                  size={15}
                  className="text-accent-ink"
                  aria-hidden
                />
                <h2
                  id="admin-subject-edit"
                  className="m-0 text-[13px] font-semibold"
                >
                  Edit subject
                </h2>
              </div>
              <SubjectForm
                subject={{
                  code: subject.code,
                  name: subject.name,
                  semester: subject.semester,
                  ects: subject.ects,
                  description: subject.description,
                  platformUrl: subject.platformUrl,
                }}
              />
            </section>

            <section aria-labelledby="admin-subject-assign" className={box}>
              <div className={boxHead}>
                <UserPlus size={15} className="text-accent-ink" aria-hidden />
                <h2
                  id="admin-subject-assign"
                  className="m-0 text-[13px] font-semibold"
                >
                  Assign a lecturer
                </h2>
              </div>
              {options.length === 0 ? (
                <p className="m-0 px-3 py-3 text-muted">
                  No lecturers yet. Add one on the{' '}
                  <Link href="/admin/lecturers" className={link}>
                    Lecturers tab
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <p className="m-0 border-b border-line px-3 py-2 text-muted">
                    A class type or group the subject does not have yet is
                    created.
                  </p>
                  <AssignLecturerForm
                    code={subject.code}
                    lecturers={options}
                    label="Assign a lecturer to any class"
                  />
                </>
              )}
            </section>
          </div>

          <section
            aria-labelledby="admin-subject-classes"
            className="flex min-w-0 flex-col gap-3"
          >
            <h2
              id="admin-subject-classes"
              className="m-0 text-[15px] font-semibold"
            >
              Classes
            </h2>
            {subject.classes.length === 0 ? (
              <p className="m-0 rounded-md border border-dashed border-line-strong px-3 py-4 text-muted">
                No classes yet. Assigning a lecturer creates the class; the
                timetable sync and the Discord forum tags add them too.
              </p>
            ) : (
              subject.classes.map((c) => {
                const headId = `admin-class-${c.id}`;
                return (
                  <section key={c.id} aria-labelledby={headId} className={box}>
                    <div className={boxHead}>
                      <ChalkboardTeacher
                        size={15}
                        className="text-accent-ink"
                        aria-hidden
                      />
                      <h3
                        id={headId}
                        lang="pl"
                        className="m-0 text-[13px] font-semibold"
                      >
                        {CLASS_NAMES[c.kind]}
                      </h3>
                      <span className="ml-auto text-xs text-muted" lang="pl">
                        {c.groups.length === 0
                          ? 'no groups'
                          : c.groups.map((g) => g.name).join(', ')}
                      </span>
                    </div>
                    {/* Two columns only when the card itself is wide enough (at lg the
                        classes column is narrow). */}
                    <div className="@container">
                      <div className="grid grid-cols-1 @2xl:grid-cols-2">
                        <div className="min-w-0 border-line @2xl:border-r">
                          <ClassForm
                            code={subject.code}
                            kind={c.kind}
                            assessment={c.assessment}
                            note={c.assessmentNote}
                            platformUrl={c.platformUrl}
                          />
                        </div>
                        <div className="min-w-0 border-t border-line @2xl:border-t-0">
                          {/* Remove's message outlives the row it removes; Assign clears it. */}
                          <CardStatus>
                            <h4
                              id={`${headId}-lecturers`}
                              className="m-0 px-3 pt-3 text-[13px] font-semibold"
                            >
                              Lecturers
                            </h4>
                            {c.lecturers.length === 0 ? (
                              <p className="m-0 px-3 pt-1 text-muted">
                                None assigned.
                              </p>
                            ) : (
                              <ul
                                aria-labelledby={`${headId}-lecturers`}
                                className="px-3 pt-1"
                              >
                                {c.lecturers.map((l) => {
                                  const who = lecturerLabel(l);
                                  const where = l.groupName
                                    ? `${CLASS_NAMES[c.kind]}, ${l.groupName}`
                                    : CLASS_NAMES[c.kind];
                                  return (
                                    <li
                                      key={l.id}
                                      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line py-1 last:border-b-0"
                                    >
                                      <Link
                                        href={`/admin/lecturers/${l.lecturerId}`}
                                        className={`${link} min-w-0 flex-1 truncate`}
                                        lang="pl"
                                      >
                                        {who}
                                      </Link>
                                      <span className="shrink-0 text-xs text-muted">
                                        {l.groupName ?? 'all groups'}
                                      </span>
                                      <ActionButton
                                        action={unassignLecturerAction}
                                        fields={{ id: String(l.id) }}
                                        label="Remove"
                                        ariaLabel={`Remove ${who} from ${where}`}
                                        pendingLabel="Removing…"
                                        confirm={{
                                          question: `Remove ${who} from ${where}?`,
                                          confirmLabel: 'Confirm remove',
                                        }}
                                        className="flex flex-col items-end"
                                        cardStatus
                                      />
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                            <CardStatusArea />
                            {options.length > 0 && (
                              <AssignLecturerForm
                                code={subject.code}
                                kind={c.kind}
                                lecturers={options}
                                label={`Assign a lecturer to ${CLASS_NAMES[c.kind]}`}
                              />
                            )}
                          </CardStatus>
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })
            )}
          </section>
        </div>
      </div>
    </>
  );
}

import {
  BookOpenText,
  CalendarBlank,
  ChalkboardTeacher,
  ChatsCircle,
  Files,
  Graph,
  Stack,
  TerminalWindow,
  TreeStructure,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr';
import { MARK_NOTE_MAX } from '@studies/db';
import { ASSESSMENT_NAMES } from '@studies/db/constants';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { type ReactNode, Suspense } from 'react';
import { PreviewPanel } from '@/components/explorer/PreviewPanel';
import { TagSelect } from '@/components/explorer/TagSelect';
import {
  LazyDataMap,
  LazyDesignerDiagram,
  LazySqlConsole,
} from '@/components/lazy-tabs';
import { EntryQuizSection } from '@/components/plan/EntryQuizSection';
import { PlanWeekTab } from '@/components/plan/PlanWeekTab';
import { ResultGrid } from '@/components/ResultGrid';
import { PlanWeekSkeleton } from '@/components/Skeleton';
import {
  type Crumb,
  ScreenHeader,
  type Tab,
} from '@/components/shell/ScreenHeader';
import type { Cell } from '@/lib/cells';
import { getDb, getViewsPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { loadEntryQuiz } from '@/lib/entry-quiz';
import {
  type ExplorerFilters,
  type ExplorerParams,
  type ExplorerTab,
  explorerHref,
  parseExplorerFilters,
  parseExplorerPaging,
  parseExplorerParams,
  subjectTabHref,
  withResolvedSelection,
} from '@/lib/explorer';
import { formatDate, safeExternalUrl } from '@/lib/format';
import { nowWall } from '@/lib/plan';
import { wallDateKey } from '@/lib/plan-view';
import {
  getExplorerFile,
  getSubject,
  getSubjectTree,
  listSubjectClasses,
  listSubjectLecturers,
  listSubjectTags,
  NONE_NAME,
  pageExplorerFiles,
  resolveSubjectSelection,
  type SubjectClass,
  type SubjectInfo,
} from '@/lib/queries';
import { DEFAULT_PER_PAGE } from '@/lib/result-grid';
import { selectionPath } from '@/lib/schema-relations';
import { requireUser } from '@/lib/session';
import { sqlHref } from '@/lib/sql-editor';
import {
  buildExplorerGridSql,
  type ExplorerSqlSelection,
  lit,
  SUBJECT_FILE_COLUMNS,
} from '@/lib/sql-prefill';
import { listViewColumns } from '@/lib/tables';
import { lecturerHref } from '@/lib/view-links';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const MAX_PREFILL = 4000;

const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';
const warnBox =
  'rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg';

/** Subject screen (design 88-104, 330-352, 445-472): Files, Lecturers, Timetable, SQL, Data map, Schema. */
export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const { code: rawCode } = await params;
  const sp = await searchParams;
  const db = getDb();
  const subject = await getSubject(db, decodeURIComponent(rawCode));
  if (!subject) notFound();
  const code = subject.code;

  const [tree, subjectTags, classList] = await Promise.all([
    getSubjectTree(db, subject.id),
    listSubjectTags(db, subject.id),
    listSubjectClasses(db, subject.id),
  ]);
  const sel = resolveSubjectSelection(classList, tree, parseExplorerParams(sp));
  // Topic links without class/group: add them so the nav tree highlights the topic.
  const resolved = withResolvedSelection(sp, sel);
  if (resolved) {
    redirect(`/subjects/${encodeURIComponent(code)}?${resolved}`);
  }
  const tab = sel.tab;
  const parsed = parseExplorerFilters(sp);
  // On the SQL tab `q` is the editor prefill, not the filename filter.
  // A tag from another subject is ignored rather than emptying the table.
  const filters: ExplorerFilters = {
    ...parsed,
    q: tab === 'sql' ? '' : parsed.q,
    tag: subjectTags.some((t) => t.id === parsed.tag) ? parsed.tag : null,
  };

  const cls =
    sel.classKind === 'none'
      ? undefined
      : classList.find((c) => c.kind === sel.classKind);
  const grp = cls?.groups.find((g) => g.number === sel.group);
  const treeCls = tree.find((c) => c.kind === sel.classKind);
  const topic =
    sel.topic == null
      ? undefined
      : [
          ...(treeCls?.topics ?? []),
          ...(treeCls?.groups.flatMap((g) => g.topics) ?? []),
        ].find((t) => t.id === sel.topic);
  const className = sel.classKind === 'none' ? NONE_NAME : cls?.name;

  // Selection without file/tab; filters kept (tag, q, sort, dir).
  const at = (p: Partial<ExplorerParams>, f: Partial<ExplorerFilters> = {}) =>
    explorerHref(
      code,
      {
        classKind: sel.classKind,
        group: sel.group,
        topic: sel.topic,
        ...p,
      },
      { ...filters, ...f },
    );

  const crumbs: Crumb[] = [
    {
      icon: BookOpenText,
      kind: 'Subject:',
      label: subject.name,
      href: explorerHref(code, {}, filters),
    },
  ];
  if (sel.classKind && className) {
    crumbs.push({
      icon: Stack,
      label: className,
      href: explorerHref(code, { classKind: sel.classKind }, filters),
    });
  }
  if (sel.classKind && grp) {
    crumbs.push({
      icon: UsersThree,
      label: grp.name,
      href: explorerHref(
        code,
        { classKind: sel.classKind, group: grp.number },
        filters,
      ),
    });
  }
  if (topic) {
    crumbs.push({
      icon: ChatsCircle,
      kind: 'Topic:',
      label: topic.title,
      href: at({}),
    });
  }

  const TAB_DEFS: [ExplorerTab, string, Tab['icon']][] = [
    ['explorer', 'Files', Files],
    ['lecturers', 'Lecturers', ChalkboardTeacher],
    ['plan', 'Timetable', CalendarBlank],
    ['sql', 'SQL', TerminalWindow],
    ['map', 'Data map', Graph],
    ['schema', 'Schema', TreeStructure],
  ];
  const tabs: Tab[] = TAB_DEFS.map(([key, label, icon]) => ({
    label,
    icon,
    href: subjectTabHref(code, sel, filters, key),
    active: key === tab,
  }));

  const tagOptions = [
    { value: '', label: 'All', href: at({ tab }, { tag: null }) },
    ...subjectTags.map((t) => ({
      value: String(t.id),
      label: t.name,
      href: at({ tab }, { tag: t.id }),
    })),
  ];

  // SQL tab keeps the selection (nav highlight, crumbs) but no grid filters.
  const sqlPath = subjectTabHref(code, sel, filters, 'sql');
  const sqlSel: ExplorerSqlSelection = {
    className: cls?.name,
    noClass: sel.classKind === 'none',
    groupName: grp?.name,
    topicId: sel.topic ?? undefined,
  };

  return (
    <>
      <ScreenHeader crumbs={crumbs} tabs={tabs} />
      <div className="flex flex-col gap-3.5">
        <SubjectHeader
          subject={subject}
          tag={filters.tag == null ? '' : String(filters.tag)}
          tagOptions={tagOptions}
          showTag={tab === 'explorer'}
        />
        {tab === 'explorer' && (
          <>
            <FilesTab
              subjectId={subject.id}
              code={code}
              sel={sel}
              filters={filters}
              sp={sp}
              sqlSel={sqlSel}
              sqlPath={sqlPath}
            />
            {sel.classKind !== 'none' && (
              <ClassEntryQuiz
                classes={cls ? [cls] : classList}
                defaultGroupId={grp?.id ?? null}
                isAdmin={user.isAdmin}
              />
            )}
          </>
        )}
        {tab === 'lecturers' && (
          <LecturersTab subjectId={subject.id} classList={classList} />
        )}
        {tab === 'plan' && (
          <Suspense fallback={<PlanWeekSkeleton />}>
            <PlanWeekTab
              week={sp.week}
              path={`/subjects/${encodeURIComponent(code)}`}
              extra={Object.fromEntries(
                new URLSearchParams(
                  subjectTabHref(code, sel, filters, 'plan').split('?')[1],
                ),
              )}
              filter={{ subjectId: subject.id }}
              myGroupsFilter={false}
            />
          </Suspense>
        )}
        {tab === 'sql' && <SqlTab code={code} q={sp.q} editPath={sqlPath} />}
        {tab === 'map' && (
          <LazyDataMap
            subject={{ code, name: subject.name }}
            tree={tree}
            sel={sel}
          />
        )}
        {tab === 'schema' && (
          <SchemaTab
            path={selectionPath(sel, {
              subject: subject.name,
              subjectId: subject.id,
              className,
              classId: cls?.id ?? null,
              groupName: grp?.name,
              groupId: grp?.id,
            })}
          />
        )}
      </div>
    </>
  );
}

function SubjectHeader({
  subject,
  tag,
  tagOptions,
  showTag,
}: {
  subject: SubjectInfo;
  tag: string;
  tagOptions: { value: string; label: string; href: string }[];
  /** The tag only filters Files. */
  showTag: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <h1 lang="pl" className="m-0 text-xl font-semibold tracking-[-0.01em]">
          {subject.name}
        </h1>
        <p className="mt-0.5 font-mono text-xs text-muted">
          {subject.code}, semester {subject.semester}, {subject.ects} ECTS
        </p>
        {subject.platformUrl && (
          <p className="mt-1 text-xs">
            <ExternalLink url={subject.platformUrl}>
              Subject platform ↗
            </ExternalLink>
          </p>
        )}
        {subject.description && (
          <p
            lang="pl"
            className="mt-1.5 max-w-[65ch] whitespace-pre-line text-muted"
          >
            {subject.description}
          </p>
        )}
      </div>
      {showTag && <TagSelect value={tag} options={tagOptions} />}
    </div>
  );
}

async function FilesTab({
  subjectId,
  code,
  sel,
  filters,
  sp,
  sqlSel,
  sqlPath,
}: {
  subjectId: number;
  code: string;
  sel: ExplorerParams;
  filters: ExplorerFilters;
  sp: SP;
  sqlSel: ExplorerSqlSelection;
  sqlPath: string;
}) {
  const db = getDb();
  const paging = parseExplorerPaging(sp);
  const [res, openFile] = await Promise.all([
    pageExplorerFiles(db, subjectId, sel, {
      tagId: filters.tag ?? undefined,
      q: filters.q,
      sort: filters.sort ?? undefined,
      dir: filters.dir ?? undefined,
      page: paging.page,
      perPage: paging.perPage,
    }),
    sel.file != null
      ? getExplorerFile(db, subjectId, sel.file)
      : Promise.resolve(null),
  ]);

  // Current grid params (no file): selection, filters, per, page.
  const listHref = explorerHref(
    code,
    { ...sel, file: null, tab: 'explorer' },
    filters,
  );
  const basePath = listHref.split('?')[0];
  const keep = new URLSearchParams(listHref.split('?')[1] ?? '');
  const csvHref = `/subjects/${encodeURIComponent(code)}/csv${keep.size ? `?${keep}` : ''}`;
  if (paging.perPage !== DEFAULT_PER_PAGE) {
    keep.set('per', String(paging.perPage));
  }
  if (res.page > 1) keep.set('page', String(res.page));
  const closeHref = keep.size ? `${basePath}?${keep}` : basePath;

  const sort = filters.sort ?? 'created';
  const dir = filters.dir ?? (filters.sort ? 'asc' : 'desc');
  const gridSql = buildExplorerGridSql(code, sqlSel, {
    tagId: filters.tag,
    q: filters.q,
    sort: filters.sort,
    dir: filters.dir,
    page: res.page,
    perPage: paging.perPage,
  });

  const rows: Cell[][] = res.files.map((f) => [
    f.id,
    {
      text: f.topicTitle,
      href: explorerHref(code, { topic: f.topicId }, filters),
    },
    f.filename,
    f.previewKind,
    f.uploader,
    formatDate(f.createdAt),
  ]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <ResultGrid
          columns={[...SUBJECT_FILE_COLUMNS]}
          rows={rows}
          sql={gridSql}
          total={res.total}
          nav={{ basePath, query: keep.toString(), previewParam: 'file' }}
          paging={{
            page: res.page,
            pageCount: res.pageCount,
            perPage: paging.perPage,
          }}
          sorting={{
            sort,
            dir,
            sortKeys: [null, 'topic', 'filename', null, 'uploader', 'created'],
          }}
          fileColumn={0}
          linkColumn={2}
          badges={res.files.map((f) => f.status)}
          selectedId={sel.file}
          editSqlHref={sqlHref(sqlPath, gridSql)}
          csvHref={csvHref}
          name={`${code}-files`}
        />
      </div>
      {sel.file != null && (
        <div className="lg:sticky lg:top-12 lg:w-[360px] lg:shrink-0">
          <PreviewPanel file={openFile} closeHref={closeHref} />
        </div>
      )}
    </div>
  );
}

/** "Entry quiz every session" of the selected class (or every class). */
async function ClassEntryQuiz({
  classes,
  defaultGroupId,
  isAdmin,
}: {
  classes: SubjectClass[];
  defaultGroupId: number | null;
  isAdmin: boolean;
}) {
  if (classes.length === 0) return null;
  const view = await loadEntryQuiz(getDb(), classes, {
    isAdmin,
    today: wallDateKey(nowWall()),
  });
  return (
    <EntryQuizSection
      classes={view}
      defaultGroupId={defaultGroupId}
      noteMax={MARK_NOTE_MAX}
    />
  );
}

const th = 'border-b border-line-strong px-2.5 py-[7px] font-semibold';
const td = 'border-b border-line px-2.5 py-1';

/**
 * An external link (new tab) when `url` is http(s); anything else is shown as
 * plain text, never as an href.
 */
function ExternalLink({ url, children }: { url: string; children: ReactNode }) {
  const safe = safeExternalUrl(url);
  if (!safe) return <span className="break-all text-muted">{url}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="link"
      title={safe}
    >
      {children}
    </a>
  );
}

function assessmentText(c: SubjectClass): string | null {
  const name = c.assessment ? ASSESSMENT_NAMES[c.assessment] : null;
  const note = c.assessmentNote?.trim() || null;
  if (name && note) return `${name} — ${note}`;
  return name ?? note;
}

const empty = <span className="text-faint">—</span>;

async function LecturersTab({
  subjectId,
  classList,
}: {
  subjectId: number;
  classList: SubjectClass[];
}) {
  const rows = await listSubjectLecturers(getDb(), subjectId);
  return (
    <div className="flex flex-col gap-3.5">
      {classList.length > 0 && (
        <div className="shrink-0 overflow-auto rounded-md border border-line-strong">
          <table
            aria-label="Classes"
            className="w-full min-w-[560px] border-collapse"
          >
            <thead>
              <tr className="bg-surface text-left">
                <th className={th}>Class</th>
                <th className={th}>Assessment</th>
                <th className={th}>Platform</th>
              </tr>
            </thead>
            <tbody>
              {classList.map((c, i) => {
                const assessment = assessmentText(c);
                return (
                  <tr
                    key={c.id}
                    className={`hover:bg-list-hover ${i % 2 ? 'bg-zebra' : ''}`}
                  >
                    <td className={td}>{c.name}</td>
                    <td className={td}>{assessment ?? empty}</td>
                    <td className={td}>
                      {c.platformUrl ? (
                        <ExternalLink url={c.platformUrl}>
                          Platform ↗
                        </ExternalLink>
                      ) : (
                        empty
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="shrink-0 overflow-auto rounded-md border border-line-strong">
        <table
          aria-label="Lecturers"
          className="w-full min-w-[760px] border-collapse"
        >
          <thead>
            <tr className="bg-surface text-left">
              <th className={th}>Class</th>
              <th className={th}>Group</th>
              <th className={th}>Lecturer</th>
              <th className={th}>E-mail</th>
              <th className={th}>Office hours</th>
              <th className={th}>Room</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
                key={i}
                className={`hover:bg-list-hover ${i % 2 ? 'bg-zebra' : ''}`}
              >
                <td className={td}>{l.className}</td>
                <td className={`${td} text-muted`}>{l.groupName ?? 'all'}</td>
                <td className={td}>
                  <Link href={lecturerHref(l.id)} className="link">
                    {[l.title, l.name].filter(Boolean).join(' ')}
                  </Link>
                </td>
                <td className={`${td} font-mono text-xs`}>{l.email || '—'}</td>
                <td className={`${td} whitespace-pre-line`}>
                  {l.officeHours || empty}
                </td>
                <td className={td}>{l.room || empty}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">
                  The query returned no rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function SqlTab({
  code,
  q,
  editPath,
}: {
  code: string;
  q: string | string[] | undefined;
  editPath: string;
}) {
  // Prefill only: the editor shows it, the user runs it.
  const initialQuery =
    typeof q === 'string' && q.trim()
      ? q.slice(0, MAX_PREFILL)
      : `SELECT * FROM v_files WHERE subject_code = ${lit(code)}`;
  let schema: Record<string, string[]> | undefined;
  let error: string | null = null;
  try {
    schema = await listViewColumns(getViewsPool());
  } catch (err) {
    error = roErrorMessage(err);
  }
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div role="alert" className={warnBox}>
          Could not load the column list: {error}
        </div>
      )}
      <LazySqlConsole
        key={initialQuery}
        initialQuery={initialQuery}
        schema={schema ?? {}}
        editPath={editPath}
      />
    </div>
  );
}

async function SchemaTab({ path }: { path: ReturnType<typeof selectionPath> }) {
  let columns: Awaited<ReturnType<typeof listViewColumns>> | null = null;
  let error: string | null = null;
  try {
    columns = await listViewColumns(getViewsPool());
  } catch (err) {
    error = roErrorMessage(err);
  }
  if (!columns) {
    return (
      <div role="alert" className={errBox}>
        {error}
      </div>
    );
  }
  return (
    <LazyDesignerDiagram
      columns={columns}
      highlight={{ views: path.views, caption: path.caption }}
    />
  );
}

import { notFound } from 'next/navigation';
import { DataMap } from '@/components/explorer/DataMap';
import { ExplorerShell } from '@/components/explorer/ExplorerShell';
import { ExplorerTable } from '@/components/explorer/ExplorerTable';
import { ExplorerTree } from '@/components/explorer/ExplorerTree';
import { PreviewPanel } from '@/components/explorer/PreviewPanel';
import { SchemaDiagram } from '@/components/SchemaDiagram';
import { getDb, getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import {
  explorerHref,
  parseExplorerFilters,
  parseExplorerParams,
} from '@/lib/explorer';
import {
  getExplorerFile,
  getSubject,
  getSubjectTree,
  listExplorerFiles,
  listSubjectTags,
  resolveSelection,
} from '@/lib/queries';
import { selectionPath } from '@/lib/schema-relations';
import { requireUser } from '@/lib/session';
import { buildExplorerSql } from '@/lib/sql-prefill';
import { listViewColumns } from '@/lib/tables';

export const dynamic = 'force-dynamic';

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const { code: rawCode } = await params;
  const sp = await searchParams;
  const db = getDb();
  const subject = await getSubject(db, decodeURIComponent(rawCode));
  if (!subject) notFound();
  const code = subject.code;

  const requested = parseExplorerParams(sp);
  const parsedFilters = parseExplorerFilters(sp);
  const [tree, subjectTags] = await Promise.all([
    getSubjectTree(db, subject.id),
    listSubjectTags(db, subject.id),
  ]);
  const sel = resolveSelection(tree, requested);
  // A tag from another subject is ignored rather than emptying the table.
  const filters = {
    ...parsedFilters,
    tag: subjectTags.some((t) => t.id === parsedFilters.tag)
      ? parsedFilters.tag
      : null,
  };
  const isExplorer = sel.tab === 'explorer';
  const [files, openFile] = await Promise.all([
    isExplorer
      ? listExplorerFiles(db, subject.id, sel, {
          tagId: filters.tag ?? undefined,
          q: filters.q,
          sort: filters.sort ?? undefined,
          dir: filters.dir ?? undefined,
        })
      : Promise.resolve([]),
    isExplorer && sel.file != null
      ? getExplorerFile(db, subject.id, sel.file)
      : Promise.resolve(null),
  ]);

  let schemaColumns: Awaited<ReturnType<typeof listViewColumns>> | null = null;
  let schemaError: string | null = null;
  if (sel.tab === 'schema') {
    try {
      schemaColumns = await listViewColumns(getRoPool());
    } catch (err) {
      schemaError = roErrorMessage(err);
    }
  }

  const cls = tree.find((c) => c.kind === sel.classKind);
  const grp = cls?.groups.find((g) => g.number === sel.group);
  const topic =
    sel.topic == null
      ? undefined
      : [...(grp?.topics ?? []), ...(cls?.topics ?? [])].find(
          (t) => t.id === sel.topic,
        );
  const path = selectionPath(sel, {
    subject: subject.name,
    subjectId: subject.id,
    className: cls?.name,
    classId: cls?.id,
    groupName: grp?.name,
    groupId: grp?.id,
  });
  const node = (p: Parameters<typeof explorerHref>[1]) =>
    explorerHref(code, p, filters);
  const crumbs = [{ label: subject.name, href: node({}) }];
  if (cls) {
    crumbs.push({ label: cls.name, href: node({ classKind: cls.kind }) });
  }
  if (cls && grp) {
    crumbs.push({
      label: grp.name,
      href: node({ classKind: cls.kind, group: grp.number }),
    });
  }
  if (cls && topic) {
    crumbs.push({
      label: topic.title,
      href: node({ classKind: cls.kind, group: grp?.number, topic: topic.id }),
    });
  }

  const scopeLabel = topic
    ? 'w tym temacie'
    : grp
      ? 'w tej grupie'
      : cls
        ? 'w tej kategorii'
        : 'w tym przedmiocie';
  const sqlHref = `/sql?${new URLSearchParams({
    q: buildExplorerSql(code, {
      className: cls && cls.kind !== 'none' ? cls.name : undefined,
      noClass: cls?.kind === 'none',
      groupName: grp?.name,
      topicId: sel.topic ?? undefined,
    }),
  })}`;
  const csvQs = new URLSearchParams(
    explorerHref(code, { ...sel, file: null, tab: 'explorer' }, filters).split(
      '?',
    )[1] ?? '',
  ).toString();
  const csvHref = `/subjects/${encodeURIComponent(code)}/csv${csvQs ? `?${csvQs}` : ''}`;
  const closeHref = explorerHref(code, { ...sel, file: null }, filters);

  return (
    <ExplorerShell
      title={subject.name}
      meta={`${subject.code}, semestr ${subject.semester}, ${subject.ects} ECTS`}
      description={subject.description}
      crumbs={crumbs}
      tab={sel.tab}
      tabHref={(tab) =>
        explorerHref(code, { ...sel, file: null, tab }, filters)
      }
    >
      {sel.tab === 'map' ? (
        <DataMap subject={{ code, name: subject.name }} tree={tree} sel={sel} />
      ) : sel.tab === 'schema' ? (
        schemaColumns ? (
          <SchemaDiagram
            columns={schemaColumns}
            highlight={path.views}
            caption={path.caption}
          />
        ) : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {schemaError}
          </p>
        )
      ) : tree.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-panel px-6 py-12 text-center">
          <p className="font-medium">Brak tematów w tym przedmiocie</p>
          <p className="mt-1 text-sm text-muted">
            Tematy pojawią się po dodaniu wątku w kanale przedmiotu na
            Discordzie.
          </p>
        </div>
      ) : (
        <div
          className={`grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] ${
            sel.file != null ? 'lg:grid-cols-[220px_minmax(0,1fr)_360px]' : ''
          }`}
        >
          <ExplorerTree code={code} tree={tree} sel={sel} filters={filters} />
          <ExplorerTable
            code={code}
            files={files}
            sel={sel}
            filters={filters}
            subjectTags={subjectTags}
            selectedFileId={openFile?.id ?? null}
            scopeLabel={scopeLabel}
            sqlHref={sqlHref}
            csvHref={csvHref}
          />
          {sel.file != null && (
            <div className="lg:sticky lg:top-4 lg:self-start">
              <PreviewPanel file={openFile} closeHref={closeHref} />
            </div>
          )}
        </div>
      )}
    </ExplorerShell>
  );
}

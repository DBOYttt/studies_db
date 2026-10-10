import {
  ArrowDown,
  ArrowUp,
  DownloadSimple,
  File,
  FileImage,
  FilePdf,
  FileText,
  MagnifyingGlass,
  Terminal,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { StatusBadge } from '@/components/StatusBadge';
import {
  type ExplorerFilters,
  type ExplorerParams,
  explorerHref,
  type SortKey,
} from '@/lib/explorer';
import { formatDate, pluralPl } from '@/lib/format';
import type { ExplorerFile } from '@/lib/queries';

const KIND = {
  pdf: { label: 'PDF', Icon: FilePdf },
  image: { label: 'Obraz', Icon: FileImage },
  text: { label: 'Tekst', Icon: FileText },
  none: { label: 'Inny', Icon: File },
} as const;

const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm hover:border-accent';

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: 'topic', label: 'Temat' },
  { key: 'filename', label: 'Plik' },
  { key: null, label: 'Typ' },
  { key: 'uploader', label: 'Autor' },
  { key: 'created', label: 'Dodano' },
];

export function ExplorerTable({
  code,
  files,
  sel,
  filters,
  subjectTags,
  selectedFileId,
  scopeLabel,
  sqlHref,
  csvHref,
}: {
  code: string;
  files: ExplorerFile[];
  sel: ExplorerParams;
  filters: ExplorerFilters;
  subjectTags: { id: number; name: string }[];
  selectedFileId: number | null;
  /** e.g. "w tej grupie", used in the empty state */
  scopeLabel: string;
  sqlHref: string;
  csvHref: string;
}) {
  const base = { classKind: sel.classKind, group: sel.group, topic: sel.topic };
  const hrefWith = (p: Partial<ExplorerParams>, f: Partial<ExplorerFilters>) =>
    explorerHref(code, { ...base, ...p }, { ...filters, ...f });
  const activeSort: SortKey = filters.sort ?? 'created';
  const activeDir = filters.dir ?? (filters.sort ? 'asc' : 'desc');
  const filtered = filters.tag != null || filters.q !== '';
  const maxed = files.length >= 500;

  return (
    <section aria-label="Pliki" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          action={`/subjects/${encodeURIComponent(code)}`}
          method="get"
          className="flex min-w-0 basis-full items-center gap-2 sm:basis-0 sm:flex-1"
        >
          {sel.classKind && (
            <input type="hidden" name="class" value={sel.classKind} />
          )}
          {sel.group != null && (
            <input type="hidden" name="group" value={sel.group} />
          )}
          {sel.topic != null && (
            <input type="hidden" name="topic" value={sel.topic} />
          )}
          {filters.tag != null && (
            <input type="hidden" name="tag" value={filters.tag} />
          )}
          {filters.sort && (
            <input type="hidden" name="sort" value={filters.sort} />
          )}
          {filters.dir && (
            <input type="hidden" name="dir" value={filters.dir} />
          )}
          <label className="relative block min-w-0 flex-1 sm:max-w-sm">
            <span className="sr-only">Filtruj po nazwie pliku</span>
            <MagnifyingGlass
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              maxLength={100}
              placeholder="Nazwa pliku"
              className="w-full rounded-lg border border-line bg-panel py-2 pl-9 pr-3 text-sm placeholder:text-muted"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-accent-ink px-3 py-2 text-sm font-medium text-white dark:bg-accent dark:text-on-accent"
          >
            Filtruj
          </button>
        </form>
        <a href={csvHref} className={btn}>
          <DownloadSimple size={16} aria-hidden="true" />
          Eksport CSV
        </a>
        <Link href={sqlHref} className={btn}>
          <Terminal size={16} aria-hidden="true" />
          Otwórz w SQL
        </Link>
      </div>

      {subjectTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted">Tag</span>
          <Link
            href={hrefWith({}, { tag: null })}
            aria-current={filters.tag == null ? 'true' : undefined}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              filters.tag == null
                ? 'border-accent bg-accent/10 text-accent-ink'
                : 'border-line text-muted hover:text-fg'
            }`}
          >
            Wszystkie
          </Link>
          {subjectTags.map((t) => {
            const on = t.id === filters.tag;
            return (
              <Link
                key={t.id}
                href={hrefWith({}, { tag: on ? null : t.id })}
                aria-current={on ? 'true' : undefined}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  on
                    ? 'border-accent bg-accent/10 text-accent-ink'
                    : 'border-line text-muted hover:text-fg'
                }`}
              >
                {t.name}
              </Link>
            );
          })}
        </div>
      )}

      {files.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-panel px-6 py-12 text-center">
          <p className="font-medium">
            {filtered
              ? 'Brak plików pasujących do filtrów'
              : `Brak plików ${scopeLabel}`}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtered ? (
              <Link href={hrefWith({}, { tag: null, q: '' })} className="link">
                Wyczyść filtry
              </Link>
            ) : (
              'Pliki pojawią się tu po dodaniu ich do wątku na Discordzie.'
            )}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                {COLUMNS.map((c) => {
                  const on = c.key === activeSort;
                  return (
                    <th
                      key={c.label}
                      scope="col"
                      aria-sort={
                        on
                          ? activeDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                      className="px-3 py-2 font-medium"
                    >
                      {c.key ? (
                        <Link
                          href={hrefWith(
                            {},
                            {
                              sort: c.key,
                              dir: on
                                ? activeDir === 'asc'
                                  ? 'desc'
                                  : 'asc'
                                : c.key === 'created'
                                  ? 'desc'
                                  : 'asc',
                            },
                          )}
                          className={`inline-flex items-center gap-1 hover:text-fg ${on ? 'text-fg' : ''}`}
                        >
                          {c.label}
                          {on &&
                            (activeDir === 'asc' ? (
                              <ArrowUp size={12} aria-hidden="true" />
                            ) : (
                              <ArrowDown size={12} aria-hidden="true" />
                            ))}
                        </Link>
                      ) : (
                        c.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {files.map((f) => {
                const on = f.id === selectedFileId;
                const { Icon, label } = KIND[f.previewKind];
                return (
                  <tr
                    key={f.id}
                    aria-selected={on}
                    className={on ? 'bg-accent/10' : 'hover:bg-surface'}
                  >
                    <td className="max-w-[16rem] px-3 py-2 text-muted">
                      <span className="line-clamp-2 break-words">
                        {f.topicTitle}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={hrefWith({ file: f.id }, {})}
                          aria-current={on ? 'true' : undefined}
                          className={`break-all font-medium hover:underline ${on ? 'text-accent-ink' : ''}`}
                        >
                          {f.filename}
                        </Link>
                        {f.status !== 'ready' && (
                          <StatusBadge status={f.status} />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 font-mono text-xs text-muted">
                        <Icon size={12} aria-hidden="true" />
                        {label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted">{f.uploader}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-muted">
                      {formatDate(f.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        {files.length} {pluralPl(files.length, 'plik', 'pliki', 'plików')}
        {maxed ? ' (pierwsze 500, zawęź filtry)' : ''}
      </p>
    </section>
  );
}

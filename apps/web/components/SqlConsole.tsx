'use client';

import { MariaSQL, sql } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { Warning, XCircle } from '@phosphor-icons/react';
import CodeMirror from '@uiw/react-codemirror';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PreviewPanel } from '@/components/explorer/PreviewPanel';
import { ResultGrid } from '@/components/ResultGrid';
import { SqlText } from '@/components/SqlText';
import { toCells } from '@/lib/cells';
import { EXAMPLE_QUERIES } from '@/lib/example-queries';
import type { ExplorerFile } from '@/lib/queries';
import {
  columnInsertion,
  consoleColumns,
  csvStamp,
  historyLabel,
  isDbMessage,
  sqlFileColumn,
  sqlHref,
} from '@/lib/sql-editor';
import {
  pushSqlHistory,
  readSqlHistory,
  SQL_HISTORY_EVENT,
} from '@/lib/sql-history';

export const DEFAULT_SQL = 'SELECT * FROM v_subjects LIMIT 10';

type Result =
  | {
      ok: true;
      sql: string;
      run: number;
      stamp: string;
      columns: string[];
      rows: unknown[][];
      truncated: boolean;
      durationMs: number;
    }
  | { ok: false; sql: string; error: string; fromDb: boolean };

type ApiResult =
  | {
      ok: true;
      columns: string[];
      rows: unknown[][];
      truncated: boolean;
      durationMs: number;
    }
  | { ok: false; error: string };

type Preview =
  | { id: number; state: 'loading' }
  | { id: number; state: 'done'; file: ExplorerFile | null }
  | { id: number; state: 'error' };

/** requireUser()/proxy send an expired session to /login-info (fetch follows). */
function isSessionExpired(res: Response): boolean {
  if (res.redirected) return true;
  try {
    return new URL(res.url).pathname.startsWith('/login-info');
  } catch {
    return false;
  }
}

/** Editor look (design lines 111-116): 13px mono, 20px lines, grey gutter. */
const editorTheme = EditorView.theme({
  '&': {
    minHeight: '176px',
    fontSize: '13px',
    backgroundColor: 'var(--bg)',
    color: 'var(--fg)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '20px',
  },
  '.cm-content': {
    padding: '8px 0',
    minHeight: '160px',
    caretColor: 'var(--fg)',
  },
  '.cm-line': { padding: '0 10px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--selected)' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    borderRight: '1px solid var(--border)',
    color: 'var(--subtle)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '36px',
    padding: '0 8px',
    textAlign: 'right',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--checked)',
    outline: 'none',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--panel)',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
    color: 'var(--fg)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent-fill)',
    color: 'var(--on-accent)',
  },
  '.cm-completionDetail': { color: 'inherit', opacity: 0.7 },
});

/** Same colours as the highlighted SQL boxes (lib/sql-highlight.ts). */
const sqlHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--sql-keyword)', fontWeight: '600' },
  {
    tag: [t.typeName, t.standard(t.name), t.bool, t.null],
    color: 'var(--sql-keyword)',
  },
  { tag: t.string, color: 'var(--sql-string)' },
  { tag: t.special(t.string), color: 'var(--accent-ink)', fontWeight: '500' },
  { tag: t.number, color: 'var(--sql-number)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: 'var(--faint)',
    fontStyle: 'italic',
  },
  {
    tag: [t.operator, t.punctuation, t.paren, t.bracket],
    color: 'var(--faint)',
  },
]);

const NO_SCHEMA: Record<string, string[]> = {};

const control =
  'rounded border border-line-strong bg-page px-1.5 py-[5px] text-fg';

export interface SqlConsoleProps {
  /** Editor content on mount (e.g. the `?q=` prefill); never auto-runs. */
  initialQuery?: string;
  /**
   * Columns per view (autocomplete and the "Kolumny" list). When absent the
   * console fetches them from /api/schema.
   */
  schema?: Record<string, string[]>;
  /**
   * Embedded in a view screen: "Kolumny" lists only this view's columns
   * (`columns`, else `schema[view]`) as bare names, and autocomplete
   * completes them unqualified.
   */
  embedded?: { view: string; columns?: string[] };
  /**
   * Route that hosts this console; "Edytuj w konsoli SQL" opens
   * `<editPath>?q=<sql>` (or `&q=` when `editPath` has a query). Default `/sql`.
   */
  editPath?: string;
}

/**
 * SQL console (design lines 106-152): editor + "Kolumny", the action bar,
 * the error box and the result grid with client-side file previews.
 * Safety lives in /api/sql (read-only pool, watchdog + KILL, limits).
 */
export function SqlConsole({
  initialQuery = DEFAULT_SQL,
  schema: schemaProp,
  embedded,
  editPath = '/sql',
}: SqlConsoleProps) {
  const [query, setQuery] = useState(initialQuery);
  const [fetchedSchema, setFetchedSchema] = useState<Record<
    string,
    string[]
  > | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const runRef = useRef<() => void>(() => {});
  const runCount = useRef(0);
  const previewSeq = useRef(0);

  const schema = schemaProp ?? fetchedSchema ?? NO_SCHEMA;
  const scopeView = embedded?.view;
  const scopeColumns = embedded?.columns;

  useEffect(() => {
    setHistory(readSqlHistory());
    const sync = () => setHistory(readSqlHistory());
    window.addEventListener(SQL_HISTORY_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SQL_HISTORY_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    if (schemaProp) return;
    let live = true;
    fetch('/api/schema')
      .then((r) =>
        r.ok && !r.redirected
          ? (r.json() as Promise<{ columns?: Record<string, string[]> }>)
          : {},
      )
      .then((b: { columns?: Record<string, string[]> }) => {
        if (live) setFetchedSchema(b.columns ?? {});
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [schemaProp]);

  /** Runs `sqlText` (default: the editor content). */
  const run = useCallback(
    async (sqlText?: string) => {
      const q = (sqlText ?? query).trim();
      if (running || !q) return;
      setRunning(true);
      const finish = (r: ApiResult, fromDb: boolean) => {
        runCount.current += 1;
        setPreview(null);
        setResult(
          r.ok
            ? {
                ...r,
                sql: q,
                run: runCount.current,
                stamp: csvStamp(new Date()),
              }
            : { ok: false, sql: q, error: r.error, fromDb },
        );
        // Every executed query goes to history, failed transports included.
        setHistory(pushSqlHistory(q));
      };
      try {
        const res = await fetch('/api/sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: q }),
        });
        if (isSessionExpired(res)) {
          window.location.href = '/login-info';
          return;
        }
        const isJson = res.headers
          .get('content-type')
          ?.includes('application/json');
        if (!isJson) {
          // e.g. a proxy/tunnel error page; keep the query so it can be retried
          finish({ ok: false, error: `Błąd serwera (${res.status}).` }, false);
          return;
        }
        const data = (await res.json()) as ApiResult;
        finish(data, !data.ok && isDbMessage(res.status, data.error));
      } catch {
        finish(
          { ok: false, error: 'Nie udało się połączyć z serwerem.' },
          false,
        );
      } finally {
        setRunning(false);
      }
    },
    [query, running],
  );
  runRef.current = run;

  const openPreview = useCallback(async (id: number) => {
    const seq = ++previewSeq.current;
    setPreview({ id, state: 'loading' });
    try {
      const res = await fetch(`/api/material/${id}`);
      if (isSessionExpired(res)) {
        window.location.href = '/login-info';
        return;
      }
      if (seq !== previewSeq.current) return;
      if (res.status === 404) {
        setPreview({ id, state: 'done', file: null });
      } else if (res.ok) {
        // JSON carries createdAt as an ISO string; the panel formats a Date.
        const json = (await res.json()) as Omit<ExplorerFile, 'createdAt'> & {
          createdAt: string;
        };
        if (seq !== previewSeq.current) return;
        setPreview({
          id,
          state: 'done',
          file: { ...json, createdAt: new Date(json.createdAt) },
        });
      } else {
        setPreview({ id, state: 'error' });
      }
    } catch {
      if (seq === previewSeq.current) setPreview({ id, state: 'error' });
    }
  }, []);
  const closePreview = useCallback(() => {
    previewSeq.current += 1;
    setPreview(null);
  }, []);

  const columns = useMemo(
    () =>
      consoleColumns(
        schema,
        scopeView === undefined
          ? undefined
          : { view: scopeView, columns: scopeColumns },
      ),
    [schema, scopeView, scopeColumns],
  );

  const insertColumns = (names: string[]) => {
    const view = viewRef.current;
    const text = names.join(', ');
    if (!text) return;
    if (!view) {
      setQuery((q) => `${q}${/\s$/.test(q) || !q ? '' : ' '}${text}`);
      return;
    }
    const sel = view.state.selection.main;
    const c = columnInsertion(
      view.state.doc.toString(),
      sel.from,
      sel.to,
      text,
    );
    view.dispatch({
      changes: { from: c.from, to: c.to, insert: c.insert },
      selection: { anchor: c.cursor },
      scrollIntoView: true,
    });
    view.focus();
  };

  const onColumnsKey = (e: ReactKeyboardEvent<HTMLSelectElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    insertColumns(Array.from(e.currentTarget.selectedOptions, (o) => o.value));
  };

  const clear = () => {
    setQuery('');
    viewRef.current?.focus();
  };

  const extensions = useMemo(
    () => [
      sql({
        dialect: MariaSQL,
        schema,
        defaultTable: scopeView,
        upperCaseKeywords: true,
      }),
      editorTheme,
      syntaxHighlighting(sqlHighlight),
      EditorView.contentAttributes.of({ 'aria-label': 'Zapytanie SQL' }),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current();
              return true;
            },
          },
        ]),
      ),
    ],
    [schema, scopeView],
  );

  const fileColumn = result?.ok ? sqlFileColumn(result.columns) : undefined;
  const rows = useMemo(
    () => (result?.ok ? toCells(result.rows) : []),
    [result],
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <fieldset className="m-0 min-w-0 rounded-md border border-line-strong bg-page p-0">
        <legend className="ml-2.5 px-1.5 font-semibold">
          Uruchom zapytanie SQL na bazie danych{' '}
          <span className="font-mono text-accent-ink">studies_db</span>:
        </legend>
        <div className="grid grid-cols-1 gap-3 px-3 pt-2 pb-3 md:grid-cols-[minmax(0,1fr)_210px]">
          <div className="min-w-0 overflow-hidden rounded border border-line-strong focus-within:border-accent">
            <CodeMirror
              value={query}
              onChange={setQuery}
              onCreateEditor={(v) => {
                viewRef.current = v;
              }}
              extensions={extensions}
              theme="none"
              className="h-full"
              height="100%"
              maxHeight="60vh"
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                syntaxHighlighting: false,
              }}
            />
          </div>
          <div className="flex min-h-0 flex-col gap-1.5">
            <label htmlFor="sql-columns" className="text-muted">
              Kolumny
            </label>
            <select
              id="sql-columns"
              multiple
              size={9}
              onKeyDown={onColumnsKey}
              aria-describedby="sql-columns-hint"
              className="min-h-[150px] flex-1 rounded border border-line-strong bg-page font-mono text-xs text-fg [&>option]:px-1.5 [&>option]:py-px"
            >
              {columns.map((c) => (
                <option
                  key={c.label}
                  value={c.insert}
                  onDoubleClick={() => insertColumns([c.insert])}
                >
                  {c.label}
                </option>
              ))}
            </select>
            <span id="sql-columns-hint" className="text-[11px] text-faint">
              Kliknij dwukrotnie, aby wstawić
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-b-md border-t border-line bg-bar px-3 py-2.5">
          <select
            aria-label="Przykładowe zapytania"
            className={control}
            value=""
            onChange={(e) => {
              const ex = EXAMPLE_QUERIES.find((q) => q.name === e.target.value);
              if (ex) setQuery(ex.sql);
            }}
          >
            <option value="">Przykłady…</option>
            {EXAMPLE_QUERIES.map((q) => (
              <option key={q.name} value={q.name}>
                {q.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Historia zapytań"
            className={`${control} max-w-[280px]`}
            value=""
            onChange={(e) => {
              const h = history[Number(e.target.value)];
              if (e.target.value !== '' && h !== undefined) setQuery(h);
            }}
          >
            <option value="">Historia ({history.length})…</option>
            {history.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: index is the value
              <option key={i} value={i}>
                {historyLabel(h)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={clear}
            className="rounded border border-line-strong bg-page px-2.5 py-[5px] hover:border-accent"
          >
            Wyczyść
          </button>
          <span className="text-xs text-faint">
            Tylko odczyt (SELECT) na widokach v_*. Limit 1000 wierszy i 5
            sekund.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <kbd className="font-mono text-xs text-faint max-md:hidden">
              Ctrl+Enter
            </kbd>
            <button
              type="button"
              onClick={() => run()}
              disabled={running}
              aria-busy={running}
              className="rounded bg-accent-fill px-[18px] py-1.5 font-semibold text-on-accent hover:bg-accent-fill-hover disabled:opacity-60 disabled:hover:bg-accent-fill"
            >
              {running ? 'Wykonywanie…' : 'Wykonaj'}
            </button>
          </div>
        </div>
      </fieldset>

      {result && !result.ok && (
        <div
          role="alert"
          className="flex flex-col gap-1.5 rounded-md border border-err-line bg-err-bg px-3 py-2.5"
        >
          <div className="flex items-center gap-1.5 font-semibold text-err-fg">
            <XCircle weight="fill" size={16} aria-hidden="true" />
            Błąd
          </div>
          <div className="font-semibold text-muted">Zapytanie SQL:</div>
          <pre className="m-0 whitespace-pre-wrap break-words rounded border border-err-line bg-page px-2.5 py-2 font-mono text-[12.5px]">
            <SqlText sql={result.sql} />
          </pre>
          <div className="font-semibold text-muted">
            {result.fromDb ? 'MariaDB zwrócił komunikat:' : 'Komunikat:'}
          </div>
          <code className="break-words font-mono text-err-fg">
            {result.error}
          </code>
        </div>
      )}

      {result?.ok && (
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {result.truncated && (
              <div
                role="status"
                className="flex items-center gap-2 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
              >
                <Warning weight="fill" size={16} aria-hidden="true" />
                Wynik obcięty do pierwszych 1000 wierszy (limit konsoli).
              </div>
            )}
            <ResultGrid
              resultKey={result.run}
              columns={result.columns}
              rows={rows}
              sql={result.sql}
              elapsedMs={result.durationMs}
              name={`zapytanie-${result.stamp}`}
              editSqlHref={sqlHref(editPath, result.sql)}
              onRefresh={() => run(result.sql)}
              fileColumn={fileColumn}
              onPreview={fileColumn === undefined ? undefined : openPreview}
              selectedId={preview?.id ?? null}
            />
          </div>
          {preview && (
            <div className="lg:sticky lg:top-12 lg:w-[360px] lg:shrink-0">
              {preview.state === 'done' ? (
                <PreviewPanel file={preview.file} onClose={closePreview} />
              ) : (
                <PreviewStatus
                  error={preview.state === 'error'}
                  onClose={closePreview}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Placeholder panel while /api/material/[id] loads or after it failed. */
function PreviewStatus({
  error,
  onClose,
}: {
  error: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Escape inside a form field belongs to that field (as in PreviewPanel).
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || t.closest('input, textarea, select'))
      )
        return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside
      aria-label="Podgląd pliku"
      aria-busy={!error}
      className="fixed inset-0 z-40 flex flex-col gap-3 bg-panel p-4 lg:static lg:z-auto lg:rounded-xl lg:border lg:border-line"
    >
      <p className={error ? 'text-err-fg' : 'text-muted'}>
        {error ? 'Nie udało się wczytać podglądu.' : 'Wczytywanie podglądu…'}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="self-start rounded border border-line-strong bg-page px-2.5 py-[5px] hover:border-accent"
      >
        Zamknij podgląd
      </button>
    </aside>
  );
}

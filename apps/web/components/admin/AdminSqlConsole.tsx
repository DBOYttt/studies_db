'use client';

import { MariaSQL, sql } from '@codemirror/lang-sql';
import { syntaxHighlighting } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import {
  ArrowRight,
  CheckCircle,
  Warning,
  XCircle,
} from '@phosphor-icons/react';
import CodeMirror from '@uiw/react-codemirror';
import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ResultGrid } from '@/components/ResultGrid';
import { editorTheme, sqlHighlight } from '@/components/SqlConsole';
import { SqlText } from '@/components/SqlText';
import {
  CASCADE_NOTE,
  canExecute,
  confirmWord,
  needsConfirm,
  rowCount,
  rowsWillChange,
  type WriteKind,
  type WritePreview,
} from '@/lib/admin-console';
import { toCells } from '@/lib/cells';
import { csvStamp, sqlHref } from '@/lib/sql-editor';

type ApiOk =
  | {
      ok: true;
      kind: 'select';
      columns: string[];
      rows: unknown[][];
      truncated: boolean;
    }
  | {
      ok: true;
      kind: WriteKind;
      table: string | null;
      affected: number;
      columns: string[];
      rows: unknown[][];
      cascade: boolean;
      token: string;
    }
  | {
      ok: true;
      kind: WriteKind;
      table: string | null;
      affected: number;
      auditId: number;
    };
type ApiResult = ApiOk | { ok: false; error: string };

type Outcome =
  | {
      type: 'select';
      sql: string;
      run: number;
      stamp: string;
      columns: string[];
      rows: unknown[][];
      truncated: boolean;
    }
  | {
      type: 'done';
      sql: string;
      kind: WriteKind;
      table: string | null;
      affected: number;
      auditId: number;
    }
  | { type: 'error'; sql: string; error: string };

const KIND_LABEL: Record<WriteKind, string> = {
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  replace: 'REPLACE',
};

function isSessionExpired(res: Response): boolean {
  if (res.redirected) return true;
  try {
    return new URL(res.url).pathname.startsWith('/login-info');
  } catch {
    return false;
  }
}

async function post(body: Record<string, unknown>): Promise<ApiResult | null> {
  try {
    const res = await fetch('/api/admin/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (isSessionExpired(res)) {
      window.location.href = '/login-info';
      return null;
    }
    if (!res.headers.get('content-type')?.includes('application/json')) {
      return { ok: false, error: `Server error (${res.status}).` };
    }
    return (await res.json()) as ApiResult;
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}

const secondaryBtn =
  'rounded border border-line-strong bg-page px-2.5 py-[5px] transition-colors hover:border-accent active:translate-y-px disabled:opacity-60 disabled:hover:border-line-strong';
const primaryBtn =
  'rounded bg-accent-fill px-[18px] py-1.5 font-semibold text-on-accent transition-colors hover:bg-accent-fill-hover active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-fill disabled:active:translate-y-0';

/**
 * Admin write console (spec section 3, "SQL — write"): Preview runs the
 * statement in a rolled-back transaction, Run commits exactly the
 * previewed text once. All checks are repeated by /api/admin/sql.
 */
export function AdminSqlConsole({
  initialQuery = '',
  confirmThreshold,
}: {
  initialQuery?: string;
  /** CONFIRM_THRESHOLD from lib/admin-sql.ts (server-only module). */
  confirmThreshold: number;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [preview, setPreview] = useState<WritePreview | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState<'preview' | 'execute' | null>(null);
  // Synchronous guard: a double click fires twice before React re-renders.
  const inFlight = useRef(false);
  const runCount = useRef(0);
  const previewRef = useRef<() => void>(() => {});

  const runPreview = useCallback(
    async (text?: string) => {
      const q = text ?? query;
      if (inFlight.current || !q.trim()) return;
      inFlight.current = true;
      setBusy('preview');
      setPreview(null);
      setConfirm('');
      try {
        const r = await post({ mode: 'preview', sql: q });
        if (!r) return;
        if (!r.ok) {
          setOutcome({ type: 'error', sql: q, error: r.error });
        } else if (r.kind === 'select') {
          runCount.current += 1;
          setOutcome({
            type: 'select',
            sql: q,
            run: runCount.current,
            stamp: csvStamp(new Date()),
            columns: r.columns,
            rows: r.rows,
            truncated: r.truncated,
          });
        } else if ('token' in r) {
          setOutcome(null);
          setPreview({
            sql: q,
            token: r.token,
            kind: r.kind,
            table: r.table,
            affected: r.affected,
            columns: r.columns,
            rows: r.rows,
            cascade: r.cascade === true,
          });
        }
      } finally {
        inFlight.current = false;
        setBusy(null);
      }
    },
    [query],
  );
  previewRef.current = runPreview;

  const execute = async () => {
    const p = preview;
    if (
      inFlight.current ||
      !canExecute({
        preview: p,
        query,
        busy: busy !== null,
        confirm,
        threshold: confirmThreshold,
      }) ||
      !p
    )
      return;
    inFlight.current = true;
    setBusy('execute');
    try {
      const r = await post({
        mode: 'execute',
        sql: p.sql,
        token: p.token,
        ...(needsConfirm(p, confirmThreshold) ? { confirm } : {}),
      });
      if (!r) return;
      // Whatever happened, this preview is spent: a retry needs a new one.
      setPreview(null);
      setConfirm('');
      if (!r.ok) setOutcome({ type: 'error', sql: p.sql, error: r.error });
      else if ('auditId' in r)
        setOutcome({
          type: 'done',
          sql: p.sql,
          kind: r.kind,
          table: r.table,
          affected: r.affected,
          auditId: r.auditId,
        });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const extensions = useMemo(
    () => [
      sql({ dialect: MariaSQL, upperCaseKeywords: true }),
      editorTheme,
      syntaxHighlighting(sqlHighlight),
      EditorView.contentAttributes.of({
        'aria-label': 'SQL statement (write)',
      }),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              previewRef.current();
              return true;
            },
          },
        ]),
      ),
    ],
    [],
  );

  const executable = canExecute({
    preview,
    query,
    busy: busy !== null,
    confirm,
    threshold: confirmThreshold,
  });
  const stale = preview !== null && query !== preview.sql;
  const askConfirm =
    preview !== null && needsConfirm(preview, confirmThreshold);
  const previewCells = useMemo(
    () => (preview ? toCells(preview.rows) : []),
    [preview],
  );
  const selectCells = useMemo(
    () => (outcome?.type === 'select' ? toCells(outcome.rows) : []),
    [outcome],
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        role="note"
        className="flex items-center gap-2 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
      >
        <Warning weight="fill" size={16} className="shrink-0" aria-hidden />
        <span>
          <span className="font-semibold">
            Changes are written to the database and the audit log
          </span>
          <span className="max-sm:hidden">
            {' '}
            · Preview changes nothing; the write happens only after “Run”.
          </span>
        </span>
      </div>

      <fieldset className="m-0 min-w-0 rounded-md border border-line-strong bg-page p-0">
        <legend className="ml-2.5 px-1.5 font-semibold">
          Change data in the database{' '}
          <span className="font-mono text-accent-ink">studies_db</span>:
        </legend>
        <div className="px-3 pt-2 pb-3">
          {/* min-h: the editor's 176px (editorTheme) + borders, reserved before CodeMirror mounts. */}
          <div
            data-testid="admin-sql-editor"
            className="min-h-[178px] min-w-0 overflow-hidden rounded border border-line-strong bg-page focus-within:border-accent"
          >
            <CodeMirror
              value={query}
              onChange={setQuery}
              extensions={extensions}
              theme="none"
              height="100%"
              maxHeight="60vh"
              placeholder="UPDATE topics SET title = '…' WHERE id = …"
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                syntaxHighlighting: false,
              }}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-b-md border-t border-line bg-bar px-3 py-2.5">
          <button
            type="button"
            onClick={() => setQuery('')}
            disabled={busy !== null}
            className={secondaryBtn}
          >
            Clear
          </button>
          <span className="text-xs text-pretty text-faint">
            One statement: INSERT, UPDATE, DELETE, REPLACE or SELECT, on content
            tables only.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <kbd className="font-mono text-xs text-faint max-md:hidden">
              Ctrl+Enter
            </kbd>
            <button
              type="button"
              onClick={() => runPreview()}
              disabled={busy !== null || !query.trim()}
              aria-busy={busy === 'preview'}
              className={`${secondaryBtn} px-3.5 py-1.5 font-semibold text-accent-ink`}
            >
              {busy === 'preview' ? 'Previewing…' : 'Preview'}
            </button>
            <button
              type="button"
              onClick={execute}
              disabled={!executable}
              aria-busy={busy === 'execute'}
              aria-describedby="admin-sql-exec-hint"
              className={primaryBtn}
            >
              {busy === 'execute' ? 'Running…' : 'Run'}
            </button>
          </div>
        </div>
      </fieldset>

      <p id="admin-sql-exec-hint" className="sr-only">
        Run is available after a preview, until the statement text changes.
      </p>

      {preview && (
        <section
          aria-label="Change preview"
          className="flex min-w-0 flex-col gap-3"
        >
          <div className="overflow-hidden rounded-md border border-line-strong">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-strong bg-box-head px-3 py-[7px]">
              <span className="rounded border border-line-strong bg-page px-1.5 font-mono text-xs font-semibold text-accent-ink">
                {KIND_LABEL[preview.kind]}
              </span>
              <span className="text-muted">
                Table:{' '}
                {preview.table ? (
                  <span className="font-mono text-fg">{preview.table}</span>
                ) : (
                  <span>unknown</span>
                )}
              </span>
              <span
                role="status"
                className="ml-auto font-semibold tabular-nums"
              >
                {rowsWillChange(preview.affected)}
              </span>
            </div>
            {stale && (
              <p className="m-0 border-b border-line bg-warn-bg px-3 py-2 text-warn-fg">
                The statement changed since the preview. Run the preview again
                to execute it.
              </p>
            )}
            {preview.cascade && (
              <p className="m-0 flex items-center gap-1.5 border-b border-line bg-warn-bg px-3 py-2 text-warn-fg">
                <Warning weight="fill" size={16} aria-hidden />
                {CASCADE_NOTE}
              </p>
            )}
            {askConfirm && (
              <div className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                <label htmlFor="admin-sql-confirm" className="text-pretty">
                  This change affects {rowCount(preview.affected)}. To confirm,
                  type {preview.table ? 'the table name ' : ''}
                  <code className="rounded bg-box-head px-1 font-mono font-semibold">
                    {confirmWord(preview.table)}
                  </code>
                  :
                </label>
                <input
                  id="admin-sql-confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-7 w-56 rounded border border-line-strong bg-page px-2 font-mono text-fg outline-none focus:border-accent"
                />
              </div>
            )}
          </div>
          {preview.columns.length > 0 ? (
            <ResultGrid
              resultKey={`preview-${preview.token}`}
              columns={preview.columns}
              rows={previewCells}
              sql={preview.sql}
              name={`preview-${csvStamp(new Date())}`}
              editSqlHref={sqlHref('/admin/sql', preview.sql)}
              onRefresh={() => runPreview(preview.sql)}
            />
          ) : (
            <p className="m-0 text-muted">No rows to show in the preview.</p>
          )}
        </section>
      )}

      {outcome?.type === 'error' && (
        <div
          role="alert"
          className="flex flex-col gap-1.5 rounded-md border border-err-line bg-err-bg px-3 py-2.5"
        >
          <div className="flex items-center gap-1.5 font-semibold text-err-fg">
            <XCircle weight="fill" size={16} aria-hidden />
            Error
          </div>
          <pre className="m-0 whitespace-pre-wrap break-words rounded border border-err-line bg-page px-2.5 py-2 font-mono text-[12.5px]">
            <SqlText sql={outcome.sql} />
          </pre>
          <code className="break-words font-mono text-err-fg">
            {outcome.error}
          </code>
        </div>
      )}

      {outcome?.type === 'done' && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-ok-line bg-ok-bg px-3 py-2.5 text-ok-fg"
        >
          <CheckCircle weight="fill" size={16} aria-hidden />
          <span className="font-semibold">
            Saved: {KIND_LABEL[outcome.kind]}
            {outcome.table && (
              <>
                {' '}
                on <span className="font-mono">{outcome.table}</span>
              </>
            )}
            , rows changed: {outcome.affected}.
          </span>
          <Link
            href={`/admin/audit/${outcome.auditId}`}
            className="ml-auto inline-flex items-center gap-1 text-accent-ink hover:text-accent-ink-hover hover:underline"
          >
            Audit log entry #{outcome.auditId}
            <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      )}

      {outcome?.type === 'select' && (
        <div className="flex min-w-0 flex-col gap-3">
          {outcome.truncated && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
            >
              <Warning weight="fill" size={16} aria-hidden />
              Result truncated to the first 500 rows (console limit).
            </div>
          )}
          <ResultGrid
            resultKey={outcome.run}
            columns={outcome.columns}
            rows={selectCells}
            sql={outcome.sql}
            name={`query-${outcome.stamp}`}
            editSqlHref={sqlHref('/admin/sql', outcome.sql)}
            onRefresh={() => runPreview(outcome.sql)}
          />
        </div>
      )}
    </div>
  );
}

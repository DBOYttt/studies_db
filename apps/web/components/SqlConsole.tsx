'use client';

import { MariaSQL, sql } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toCells } from '@/lib/cells';
import { toCsv } from '@/lib/csv';
import { EXAMPLE_QUERIES } from '@/lib/example-queries';
import { DataGrid } from './DataGrid';

const HISTORY_KEY = 'studiesdb.sqlHistory';
const HISTORY_MAX = 50;

type Result =
  | {
      ok: true;
      columns: string[];
      rows: unknown[][];
      truncated: boolean;
      durationMs: number;
    }
  | { ok: false; error: string };

function loadHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function SqlConsole() {
  const [query, setQuery] = useState('SELECT * FROM v_subjects LIMIT 10');
  const [schema, setSchema] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [dark, setDark] = useState(false);
  const runRef = useRef<() => void>(() => {});

  useEffect(() => {
    setHistory(loadHistory());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', on);
    fetch('/api/schema')
      .then((r) => (r.ok && !r.redirected ? r.json() : {}))
      .then(setSchema)
      .catch(() => {});
    return () => mq.removeEventListener('change', on);
  }, []);

  const run = useCallback(async () => {
    if (running || !query.trim()) return;
    setRunning(true);
    try {
      const res = await fetch('/api/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: query }),
      });
      const isJson = res.headers
        .get('content-type')
        ?.includes('application/json');
      if (res.redirected || !isJson) {
        window.location.href = '/login-info'; // session expired
        return;
      }
      const data = (await res.json()) as Result;
      setResult(data);
      const next = [query, ...loadHistory().filter((h) => h !== query)].slice(
        0,
        HISTORY_MAX,
      );
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      setHistory(next);
    } catch {
      setResult({ ok: false, error: 'Nie udało się połączyć z serwerem.' });
    } finally {
      setRunning(false);
    }
  }, [query, running]);
  runRef.current = run;

  const exportCsv = () => {
    if (!result?.ok) return;
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    const url = URL.createObjectURL(
      new Blob([toCsv(result.columns, result.rows)], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `zapytanie-${stamp}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const extensions = useMemo(
    () => [
      sql({ dialect: MariaSQL, schema, upperCaseKeywords: true }),
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
    [schema],
  );

  const select =
    'rounded border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Przykładowe zapytania"
          className={select}
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
          className={`${select} max-w-xs`}
          value=""
          onChange={(e) =>
            e.target.value && setQuery(history[Number(e.target.value) - 1])
          }
        >
          <option value="">Historia ({history.length})…</option>
          {history.map((h, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: index is the value
            <option key={i} value={i + 1}>
              {h.replace(/\s+/g, ' ').slice(0, 70)}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-hidden rounded border border-[var(--border)] font-mono text-sm">
        <CodeMirror
          value={query}
          onChange={setQuery}
          extensions={extensions}
          theme={dark ? 'dark' : 'light'}
          height="12rem"
          basicSetup={{ lineNumbers: true, foldGutter: false }}
          aria-label="Zapytanie SQL"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:text-black"
        >
          {running ? 'Wykonywanie…' : 'Uruchom'}
        </button>
        <span className="text-xs text-[var(--muted)]">Ctrl+Enter</span>
      </div>
      {result && !result.ok && (
        <div
          role="alert"
          className="rounded border border-red-500 p-3 font-mono text-sm text-red-700 dark:text-red-300"
        >
          {result.error}
        </div>
      )}
      {result?.ok && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-[var(--muted)]">
              {result.rows.length} wierszy · {result.durationMs} ms
              {result.truncated && ' · wynik obcięty (limit wierszy)'}
            </p>
            <button
              type="button"
              onClick={exportCsv}
              title={result.truncated ? 'Pierwsze 1000 wierszy' : undefined}
              className="rounded border border-[var(--border)] px-3 py-1 text-sm hover:border-[var(--accent)]"
            >
              Eksport CSV{result.truncated && ' (pierwsze 1000 wierszy)'}
            </button>
          </div>
          <DataGrid
            columns={result.columns}
            rows={toCells(result.rows)}
            mono
            empty="Zapytanie nie zwróciło wierszy."
          />
        </div>
      )}
    </div>
  );
}

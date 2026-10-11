'use client';

import { CaretDown, CaretUp, Terminal } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  readSqlHistory,
  SQL_HISTORY_EVENT,
  SQL_HISTORY_KEY,
} from '@/lib/sql-history';

/** Collapsible bar under the main column listing the SQL console history. */
export function ConsoleFooter() {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    const refresh = () => setHistory(readSqlHistory());
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === SQL_HISTORY_KEY) refresh();
    };
    window.addEventListener(SQL_HISTORY_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SQL_HISTORY_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return (
    <div className="shrink-0 border-t border-line-strong bg-bar">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="console-history"
        className="flex h-7 w-full items-center gap-2 px-3.5 text-left text-accent-ink hover:bg-surface"
      >
        <Terminal size={14} aria-hidden />
        <span className="font-semibold">Konsola</span>
        <span className="text-xs text-faint">
          Historia zapytań ({history.length})
        </span>
        <span className="flex-1" />
        {open ? (
          <CaretDown className="text-faint" aria-hidden />
        ) : (
          <CaretUp className="text-faint" aria-hidden />
        )}
      </button>
      {open && (
        <div
          id="console-history"
          className="max-h-[180px] overflow-auto border-t border-line bg-panel font-mono text-xs"
        >
          {history.length === 0 ? (
            <p className="px-3.5 py-1.5 font-sans text-faint">
              Brak zapytań. Uruchomione zapytania z konsoli SQL pojawią się
              tutaj.
            </p>
          ) : (
            <ol>
              {history.map((h, i) => (
                <li key={h}>
                  <Link
                    href={`/sql?${new URLSearchParams({ q: h })}`}
                    title={h}
                    className="flex gap-2.5 border-b border-surface px-3.5 py-[5px] text-fg hover:bg-list-hover"
                  >
                    <span className="text-subtle">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="truncate">
                      {h.replace(/\s+/g, ' ').slice(0, 200)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

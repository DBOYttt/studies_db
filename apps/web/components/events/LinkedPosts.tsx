'use client';

import { LinkSimple, MagnifyingGlass, X } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  linkTopicAction,
  searchTopicsAction,
  unlinkTopicAction,
} from '@/lib/event-actions';
import type { LinkedTopic } from '@/lib/event-queries';

const btn =
  'inline-flex h-7 items-center gap-1 rounded border border-line-strong bg-panel px-2 text-accent-ink hover:border-accent disabled:opacity-60';

const topicLabel = (t: LinkedTopic) =>
  t.subjectCode ? `${t.title} (${t.subjectCode})` : t.title;

/** "Link posts": the linked posts and a title search to add more. */
export function LinkedPosts({
  eventId,
  subjectId,
  linked,
}: {
  eventId: number;
  subjectId: number | null;
  linked: LinkedTopic[];
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LinkedTopic[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const linkedIds = new Set(linked.map((t) => t.id));

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setMessage(null);
      await fn();
    });

  const search = () =>
    run(async () => {
      setResults(await searchTopicsAction(subjectId, q));
    });

  const change = (p: Promise<{ ok: boolean; message: string }>) =>
    run(async () => {
      const r = await p;
      if (!r.ok) setMessage(r.message);
      else router.refresh();
    });

  return (
    <div className="flex flex-col gap-2.5">
      {linked.length === 0 ? (
        <p className="m-0 text-muted">No linked posts.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-lg border border-line-strong p-0">
          {linked.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 bg-panel px-3.5 py-2"
            >
              <span className="min-w-0 break-words">{topicLabel(t)}</span>
              <button
                type="button"
                disabled={pending}
                className={btn}
                aria-label={`Unlink post ${t.title}`}
                onClick={() => change(unlinkTopicAction(eventId, t.id))}
              >
                <X size={13} aria-hidden />
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <label className="sr-only" htmlFor={`topic-q-${eventId}`}>
          Search posts by title
        </label>
        <input
          id={`topic-q-${eventId}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search posts by title"
          className="h-8 w-full rounded border border-line-strong bg-panel px-2 text-fg focus:border-accent sm:w-72"
        />
        <button type="submit" disabled={pending} className={btn}>
          <MagnifyingGlass size={14} aria-hidden />
          Search
        </button>
      </form>
      {message && (
        <div role="alert" className="text-err-fg">
          {message}
        </div>
      )}
      {results && (
        <ul
          aria-label="Search results"
          className="m-0 flex list-none flex-col gap-1 p-0"
        >
          {results.length === 0 && <li className="text-muted">No results.</li>}
          {results.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 break-words">{topicLabel(t)}</span>
              {linkedIds.has(t.id) ? (
                <span className="text-xs text-muted">Linked</span>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  className={btn}
                  aria-label={`Link post ${t.title}`}
                  onClick={() => change(linkTopicAction(eventId, t.id))}
                >
                  <LinkSimple size={14} aria-hidden />
                  Link
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

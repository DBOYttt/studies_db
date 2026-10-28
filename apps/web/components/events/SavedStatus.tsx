'use client';

import { useEffect, useState } from 'react';

/** ms before the line is written, so screen readers hear it as a change. */
const STATUS_DELAY = 150;

/**
 * One-shot confirmation after adding or editing an event (`?saved=`). The
 * text is written just after mount into a polite status line, and `saved` is
 * dropped from the URL, so a reload or a shared link doesn't repeat it.
 */
export function SavedStatus({ text }: { text: string | null }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => setShown(text), STATUS_DELAY);
    const url = new URL(window.location.href);
    if (url.searchParams.has('saved')) {
      url.searchParams.delete('saved');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <p role="status" className="m-0 text-ok-fg">
      {shown}
    </p>
  );
}

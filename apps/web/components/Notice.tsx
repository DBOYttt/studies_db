'use client';

import { Info } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

/** ms before the text is written, so screen readers hear it as a change. */
const STATUS_DELAY = 150;

/**
 * A polite one-shot banner for a notice carried through a redirect
 * (`lib/notices.ts`). The live region is in the server HTML and the text is
 * written just after mount; the query key (`param`) is then dropped
 * from the URL, so a reload or a shared link doesn't repeat it.
 */
export function Notice({
  text,
  param = 'notice',
  className,
}: {
  text: string | null;
  /** Query key to drop after showing; null keeps the URL as it is. */
  param?: string | null;
  /** Classes of the live region (e.g. a margin); unused when there's no text. */
  className?: string;
}) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => setShown(text), STATUS_DELAY);
    if (param) {
      const url = new URL(window.location.href);
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        // Keeps Next's history state: only the URL changes.
        window.history.replaceState(
          window.history.state,
          '',
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
    }
    return () => clearTimeout(timer);
  }, [text, param]);
  // No notice: no live region and no empty gap in the page's layout.
  if (!text) return null;
  return (
    <div role="status" className={className}>
      {shown && (
        <p className="m-0 flex max-w-xl items-start gap-2 rounded-md border border-line-strong bg-panel px-3 py-2 text-fg">
          <Info
            size={16}
            weight="bold"
            aria-hidden
            className="mt-[2px] shrink-0 text-accent-ink"
          />
          {shown}
        </p>
      )}
    </div>
  );
}

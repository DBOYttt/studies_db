'use client';

import { createContext, type ReactNode, useContext, useState } from 'react';
import type { ActionState } from '@/lib/admin-forms';

const Report = createContext<((s: ActionState) => void) | null>(null);

/** The card's reporter, or null outside a `CardStatus`. */
export const useCardStatus = () => useContext(Report);

/**
 * A status area for a whole card: an `ActionButton` with `cardStatus` inside
 * writes its result here instead of next to itself, so the message stays
 * when the button's row goes away (e.g. "Remove" on a list item). Polite
 * `role="status"` for success, `role="alert"` for a refusal; a message
 * stays until the next result.
 */
export function CardStatus({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ActionState>(null);
  return (
    <Report.Provider value={setState}>
      {children}
      <div role="status" className="px-3 text-ok-fg not-empty:pt-1.5">
        {state?.ok ? state.message : null}
      </div>
      {state && !state.ok && (
        <p role="alert" className="m-0 px-3 pt-1.5 text-err-fg">
          {state.message}
        </p>
      )}
    </Report.Provider>
  );
}

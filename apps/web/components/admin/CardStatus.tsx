'use client';

import { createContext, type ReactNode, useContext, useState } from 'react';
import type { ActionState } from '@/lib/admin-forms';

type Card = { state: ActionState; report: (s: ActionState) => void };

const Ctx = createContext<Card | null>(null);

/** The card's reporter (`null` clears the message), or null outside one. */
export const useCardStatus = () => useContext(Ctx)?.report ?? null;

/**
 * A status area for a whole card: an `ActionButton` with `cardStatus` inside
 * writes its result here instead of next to itself, so the message stays
 * when the button's row goes away (e.g. "Remove" on a list item). Any
 * `ActionButton`/`ActionForm` inside clears it when it starts, so an old
 * message never sits beside a new action. `CardStatusArea` places it.
 */
export function CardStatus({ children }: { children: ReactNode }) {
  const [state, report] = useState<ActionState>(null);
  return <Ctx.Provider value={{ state, report }}>{children}</Ctx.Provider>;
}

/**
 * The card's messages: polite `role="status"` for success, `role="alert"`
 * for a refusal; a message stays until the next action in the card starts.
 */
export function CardStatusArea() {
  const state = useContext(Ctx)?.state ?? null;
  return (
    <>
      <div role="status" className="px-3 text-ok-fg not-empty:pt-1.5">
        {state?.ok ? state.message : null}
      </div>
      {state && !state.ok && (
        <p role="alert" className="m-0 px-3 pt-1.5 text-err-fg">
          {state.message}
        </p>
      )}
    </>
  );
}

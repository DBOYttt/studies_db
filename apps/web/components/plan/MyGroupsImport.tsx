'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { importMyGroupsAction } from '@/lib/my-groups-actions';
import { parseMyGroups } from '@/lib/plan';

/** Old browser-only storage of "Moje grupy": `{ "<class_id>": <group_id> }`. */
export const MY_GROUPS_KEY = 'studiesdb.myGroups.v1';

// At most one import per page load (also across both plan tabs and strict
// mode's double effect).
let attempted = false;

/**
 * Renders nothing. Moves a choice left in this browser's localStorage into
 * the DB once, only when the user has no saved groups there (`hasStored`
 * false); otherwise the stale key is just dropped, so it can never resurrect
 * groups the user cleared later. Always drops the key; refreshes the page
 * when something was stored.
 */
export function MyGroupsImport({ hasStored }: { hasStored: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (attempted) return;
    attempted = true;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(MY_GROUPS_KEY);
    } catch {
      return; // storage disabled
    }
    if (raw === null) return;
    const groups = hasStored ? {} : parseMyGroups(raw);
    const done = () => {
      try {
        window.localStorage.removeItem(MY_GROUPS_KEY);
      } catch {
        // nothing to clean up
      }
    };
    if (Object.keys(groups).length === 0) {
      done();
      return;
    }
    importMyGroupsAction(groups).then((imported) => {
      done();
      if (imported) router.refresh();
    }, done);
  }, [router, hasStored]);
  return null;
}

'use client';

import { useSyncExternalStore } from 'react';
import { type MyGroups, parseMyGroups } from '@/lib/plan';

/** localStorage key (binding, see the timetable plan): `{ "<class_id>": <group_id> }`. */
export const MY_GROUPS_KEY = 'studiesdb.myGroups.v1';

/** Same-tab writes; `storage` events only reach other tabs. */
const CHANGE_EVENT = 'studiesdb:my-groups';

const EMPTY: MyGroups = {};

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(MY_GROUPS_KEY);
  } catch {
    return null; // storage disabled (privacy mode): behave as "no choice"
  }
}

// useSyncExternalStore needs a stable snapshot: re-parse only on change.
let cachedRaw: string | null = null;
let cached: MyGroups = EMPTY;

function getSnapshot(): MyGroups {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseMyGroups(raw);
  }
  return cached;
}

const getServerSnapshot = () => EMPTY;

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === MY_GROUPS_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** The stored "Moje grupy" choice; `{}` on the server and before hydration. */
export function useMyGroups(): MyGroups {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Store the choice (an empty choice removes the key). */
export function saveMyGroups(g: MyGroups): void {
  try {
    if (Object.keys(g).length === 0) {
      window.localStorage.removeItem(MY_GROUPS_KEY);
    } else {
      window.localStorage.setItem(MY_GROUPS_KEY, JSON.stringify(g));
    }
  } catch {
    // Storage full or disabled: the choice just is not remembered.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

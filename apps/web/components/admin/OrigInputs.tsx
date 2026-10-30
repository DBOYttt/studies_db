'use client';

import { useCallback, useState } from 'react';
import {
  currentSnapshot,
  type OrigSnapshot,
  origName,
  savedSnapshot,
} from '@/lib/admin-form-values';

/**
 * The frozen orig values of one edit form (`OrigSnapshot`): `orig` to render
 * with `<OrigInputs>`, and `onSaved` for `ActionForm`, which advances them
 * after the form's own applied save. A refresh caused by another form keeps
 * them, so an edit typed before it is still checked against the values it
 * was typed over.
 */
export function useOrigSnapshot(
  key: string,
  server: Readonly<Record<string, string>>,
) {
  const [snap, setSnap] = useState<OrigSnapshot>(() => ({
    key,
    values: server,
  }));
  const cur = currentSnapshot(snap, key, server);
  // Another record: adjust during render (React's "storing information from
  // previous renders" pattern), not in an effect.
  if (cur !== snap) setSnap(cur);
  const onSaved = useCallback(
    (data: FormData) => setSnap((s) => savedSnapshot(s, data)),
    [],
  );
  return { orig: cur.values, onSaved };
}

/** The hidden `orig_<field>` inputs. */
export function OrigInputs({
  values,
}: {
  values: Readonly<Record<string, string>>;
}) {
  return Object.entries(values).map(([k, v]) => (
    <input key={k} type="hidden" name={origName(k)} value={v} />
  ));
}

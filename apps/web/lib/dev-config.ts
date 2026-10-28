/**
 * `onDemandEntries` for `next dev` from env (set by scripts/qa-serve.mjs):
 * how many compiled pages stay in memory and for how long, so a sandbox
 * walked by several QA agents doesn't recompile on every reload. Ignored in
 * production; unset or invalid values keep Next's defaults.
 */
export function onDemandEntriesFromEnv(
  env: Record<string, string | undefined>,
): { pagesBufferLength?: number; maxInactiveAge?: number } | undefined {
  if (env.NODE_ENV === 'production') return undefined;
  const int = (v: string | undefined) =>
    v !== undefined && /^[1-9]\d{0,8}$/.test(v) ? Number(v) : undefined;
  const pagesBufferLength = int(env.NEXT_DEV_PAGES_BUFFER);
  const maxInactiveAge = int(env.NEXT_DEV_MAX_INACTIVE_MS);
  if (pagesBufferLength === undefined && maxInactiveAge === undefined)
    return undefined;
  return {
    ...(pagesBufferLength !== undefined && { pagesBufferLength }),
    ...(maxInactiveAge !== undefined && { maxInactiveAge }),
  };
}

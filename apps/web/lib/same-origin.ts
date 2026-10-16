/**
 * Same-origin check for state-changing requests (defence in depth next to the
 * SameSite session cookie): a present Origin must equal WEB_BASE_URL's origin,
 * or the request URL's origin when WEB_BASE_URL is not set.
 */
export function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return false;
  let expected: string;
  try {
    expected = new URL(process.env.WEB_BASE_URL || req.url).origin;
  } catch {
    return true;
  }
  return origin !== expected;
}

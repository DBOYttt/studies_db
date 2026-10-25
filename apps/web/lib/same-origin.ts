/**
 * Same-origin check for state-changing requests (defence in depth next to the
 * SameSite session cookie): a present Origin must equal WEB_BASE_URL's origin,
 * or the request URL's origin when WEB_BASE_URL is not set. Without an Origin
 * the request is refused unless the browser says `Sec-Fetch-Site: same-origin`.
 * An opaque `Origin: null` is treated like a missing one: browsers send it for
 * a POST from a `Referrer-Policy: no-referrer` page (the login confirmation),
 * and also from sandboxed frames, which Sec-Fetch-Site then marks cross-site.
 */
export function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin === null || origin === 'null') {
    return req.headers.get('sec-fetch-site') !== 'same-origin';
  }
  let expected: string;
  try {
    expected = new URL(process.env.WEB_BASE_URL || req.url).origin;
  } catch {
    return true;
  }
  return origin !== expected;
}

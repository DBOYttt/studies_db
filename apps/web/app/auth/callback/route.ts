import { consumeLoginToken } from '@studies/db';
import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { forbiddenOrigin, seeOther } from '@/lib/http';
import { MAX_TOKEN_LEN } from '@/lib/install-app';
import { safeLoginNext } from '@/lib/login-next';
import { MODE_COOKIE, modeCookieOptions } from '@/lib/mode';
import { isCrossOrigin } from '@/lib/same-origin';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';

const EXPIRED = '/login-info?error=expired';

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );

function confirmPage(token: string, next: string | null): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign in to Studies DB</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafafa;color:#171717}
main{max-width:24rem;padding:2rem;text-align:center}
button{font:inherit;font-weight:600;padding:.6rem 1.5rem;border:0;border-radius:.375rem;background:#2563eb;color:#fff;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#ededed}button{background:#60a5fa;color:#000}}
</style>
</head>
<body>
<main>
<h1>Sign in to Studies DB</h1>
<form method="post" action="/auth/callback">
<input type="hidden" name="token" value="${escapeHtml(token)}">
${next === null ? '' : `<input type="hidden" name="next" value="${escapeHtml(next)}">\n`}<button type="submit">Sign in</button>
</form>
</main>
</body>
</html>
`;
}

/**
 * Shows a confirmation page only. Link previews (Discord, mail/phone
 * scanners) GET this URL, so GET must never consume the one-time token.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token || token.length > MAX_TOKEN_LEN) return seeOther(EXPIRED);
  const next = safeLoginNext(req.nextUrl.searchParams.get('next'));
  return new Response(confirmPage(token, next), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // same-origin (not no-referrer): the sign-in POST then carries a real
      // Origin, which browsers without Fetch Metadata need to pass the check.
      'Referrer-Policy': 'same-origin',
      'X-Robots-Tag': 'noindex',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

/** Consumes the token (form-encoded `token`) and starts a session. */
export async function POST(req: NextRequest) {
  // Login CSRF: a cross-site form must not sign the victim in as someone else.
  if (isCrossOrigin(req)) return forbiddenOrigin();
  let token: unknown = null;
  let rawNext: unknown = null;
  try {
    const form = await req.formData();
    token = form.get('token');
    rawNext = form.get('next');
  } catch {
    // not form-encoded
  }
  // Before the token is spent: a bad next only falls back to '/'.
  const next = safeLoginNext(rawNext);
  const result =
    typeof token === 'string' && token && token.length <= MAX_TOKEN_LEN
      ? await consumeLoginToken(getDb(), token)
      : null;
  if (!result) return seeOther(EXPIRED);
  const res = seeOther(next ?? '/');
  res.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  if (next) res.cookies.set(MODE_COOKIE, 'advanced', modeCookieOptions());
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}

import { consumeLoginToken } from '@studies/db';
import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { seeOther } from '@/lib/http';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';

const EXPIRED = '/login-info?error=expired';
const MAX_TOKEN_LEN = 512;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );

function confirmPage(token: string): string {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Zaloguj się do Studies DB</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafafa;color:#171717}
main{max-width:24rem;padding:2rem;text-align:center}
button{font:inherit;font-weight:600;padding:.6rem 1.5rem;border:0;border-radius:.375rem;background:#2563eb;color:#fff;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#ededed}button{background:#60a5fa;color:#000}}
</style>
</head>
<body>
<main>
<h1>Zaloguj się do Studies DB</h1>
<form method="post" action="/auth/callback">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<button type="submit">Zaloguj się</button>
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
  return new Response(confirmPage(token), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

/** Consumes the token (form-encoded `token`) and starts a session. */
export async function POST(req: NextRequest) {
  let token: unknown = null;
  try {
    token = (await req.formData()).get('token');
  } catch {
    // not form-encoded
  }
  const result =
    typeof token === 'string' && token && token.length <= MAX_TOKEN_LEN
      ? await consumeLoginToken(getDb(), token)
      : null;
  if (!result) return seeOther(EXPIRED);
  const res = seeOther('/');
  res.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}

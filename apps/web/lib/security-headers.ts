/**
 * Security response headers, wired up in next.config.ts `headers()`.
 *
 * No nonce: Next's inline bootstrap scripts need `'unsafe-inline'` without
 * one (audit ruling R1). `'unsafe-eval'` is for React's dev tooling only.
 * Avatars are hot-linked from Discord's CDN. pdf.js runs its worker from
 * /pdf.worker.<version>.min.mjs; CodeMirror and React Flow inject inline styles.
 */
export function contentSecurityPolicy(nodeEnv: string | undefined): string {
  const dev = nodeEnv === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://cdn.discordapp.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

type Header = { key: string; value: string };

/**
 * Paths whose route handlers set their own, stricter CSP / Referrer-Policy:
 * the login confirmation (`/auth/callback`) and the file routes (`/files/…`,
 * a sandbox CSP for risky images). next.config `headers()` would override a
 * route's own value, so these paths get only the non-conflicting headers.
 */
export const OWN_POLICY_SOURCE = '/:path((?!auth/callback$|files/).*)';

/** Headers no route sets itself: safe to send on every path. */
export function baseSecurityHeaders(nodeEnv: string | undefined): Header[] {
  const headers = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=()',
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
  // Dev and e2e servers run on plain HTTP (audit ruling R2).
  if (nodeEnv === 'production') {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000',
    });
  }
  return headers;
}

/** The next.config `headers()` rules. */
export function securityHeaderRules(
  nodeEnv: string | undefined,
): { source: string; headers: Header[] }[] {
  return [
    { source: '/:path*', headers: baseSecurityHeaders(nodeEnv) },
    {
      source: OWN_POLICY_SOURCE,
      headers: [
        {
          key: 'Content-Security-Policy',
          value: contentSecurityPolicy(nodeEnv),
        },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ];
}

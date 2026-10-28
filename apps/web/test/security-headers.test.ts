import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheHeaderRules } from '../lib/cache-headers';
import {
  contentSecurityPolicy,
  OWN_POLICY_SOURCE,
  securityHeaderRules,
} from '../lib/security-headers';

const directives = (csp: string) =>
  new Map(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name, values] as const;
      }),
  );

const asMap = (h: { key: string; value: string }[]) =>
  new Map(h.map(({ key, value }) => [key, value]));

describe('contentSecurityPolicy', () => {
  it('locks down framing, plugins, base and forms', () => {
    const d = directives(contentSecurityPolicy('production'));
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'self'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
  });

  it('allows what the app needs: inline bootstrap, styles, pdf.js worker, avatars', () => {
    const d = directives(contentSecurityPolicy('production'));
    expect(d.get('script-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get('worker-src')).toEqual(["'self'", 'blob:']);
    expect(d.get('img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https://cdn.discordapp.com',
    ]);
  });

  it("adds 'unsafe-eval' only in development", () => {
    expect(contentSecurityPolicy('production')).not.toContain('unsafe-eval');
    expect(contentSecurityPolicy('test')).not.toContain('unsafe-eval');
    expect(
      directives(contentSecurityPolicy('development')).get('script-src'),
    ).toContain("'unsafe-eval'");
  });
});

describe('securityHeaderRules', () => {
  const rule = (env: string, source: string) =>
    asMap(
      securityHeaderRules(env).find((r) => r.source === source)?.headers ?? [],
    );

  it('sends the framing and sniffing headers on every path', () => {
    const all = rule('development', '/:path*');
    expect(all.get('X-Frame-Options')).toBe('DENY');
    expect(all.get('X-Content-Type-Options')).toBe('nosniff');
    expect(all.has('Content-Security-Policy')).toBe(false);
  });

  it('sends the CSP and Referrer-Policy outside the routes with their own', () => {
    const own = rule('development', OWN_POLICY_SOURCE);
    expect(own.get('Content-Security-Policy')).toBe(
      contentSecurityPolicy('development'),
    );
    expect(own.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sends HSTS only in production (dev and e2e run on plain HTTP)', () => {
    for (const env of ['development', 'test']) {
      expect(rule(env, '/:path*').has('Strict-Transport-Security')).toBe(false);
    }
    expect(rule('production', '/:path*').get('Strict-Transport-Security')).toBe(
      'max-age=31536000',
    );
  });

  it('leaves /auth/callback and /files/ to their route handlers', () => {
    const match = getPathMatch(OWN_POLICY_SOURCE, { strict: true });
    for (const p of [
      '/',
      '/login-info',
      '/s/plan',
      '/auth/logout',
      '/auth/callbackx',
      '/api/material/1',
      '/filesx',
    ]) {
      expect(match(p), p).not.toBe(false);
    }
    for (const p of [
      '/auth/callback',
      '/files/1/original',
      '/files/2/preview',
    ]) {
      expect(match(p), p).toBe(false);
    }
  });
});

describe('next.config', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('applies the rules, hides X-Powered-By and disables image optimisation', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { default: config } = await import('../next.config');
    expect(config.poweredByHeader).toBe(false);
    expect(config.images?.unoptimized).toBe(true);
    expect(await config.headers?.()).toEqual([
      ...securityHeaderRules('production'),
      ...cacheHeaderRules(),
    ]);
  });
});

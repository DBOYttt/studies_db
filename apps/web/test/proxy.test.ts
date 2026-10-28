import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from '../proxy';

describe('proxy', () => {
  const matches = (url: string) =>
    unstable_doesMiddlewareMatch({ config, url });

  it('runs on app pages, api and file routes', () => {
    for (const u of [
      '/',
      '/sql',
      '/tables/v_users',
      '/tables/v_users/csv',
      '/search?q=x',
      '/subjects/FIZ',
      '/topics/1',
      '/files/1/original',
      '/api/sql',
      '/api/schema',
      '/api/wydarzenia/12/pliki/x',
      '/api/wydarzenia/12',
      '/login-infox',
    ]) {
      expect(matches(u), u).toBe(true);
    }
  });

  it('skips login, auth, next assets, favicon, the app icon and the pdf worker', () => {
    for (const u of [
      '/login-info',
      '/login-info?error=expired',
      '/auth/callback?token=x',
      '/auth/logout',
      '/_next/static/chunks/main.js',
      '/favicon.ico',
      '/icon.svg',
      '/icon.svg?3f9a1c2b',
      '/pdf.worker.6.3.289.min.mjs',
      '/api/wydarzenia/12/pliki',
    ]) {
      expect(matches(u), u).toBe(false);
    }
  });

  it('redirects without a sid cookie, passes through with one', () => {
    const anon = proxy(new NextRequest('http://localhost:3000/sql'));
    expect(anon.status).toBe(307);
    expect(new URL(anon.headers.get('location') as string).pathname).toBe(
      '/login-info',
    );
    const authed = proxy(
      new NextRequest('http://localhost:3000/sql', {
        headers: { cookie: 'sid=abc' },
      }),
    );
    expect(authed.headers.get('location')).toBeNull();
    expect(authed.headers.get('x-middleware-next')).toBe('1');
  });
});

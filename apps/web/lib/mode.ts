import { cookies } from 'next/headers';
import { EXAMPLE_QUERIES } from './example-queries';
import { sqlHref } from './sql-editor';

export type UiMode = 'simple' | 'advanced';

export const MODE_COOKIE = 'studiesdb.mode';

export function modeCookieOptions() {
  return {
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  };
}

/** Missing or invalid cookie value means the simple (Prosty) mode. */
export function parseMode(v: string | undefined): UiMode {
  return v === 'advanced' ? 'advanced' : 'simple';
}

export async function currentMode(): Promise<UiMode> {
  return parseMode((await cookies()).get(MODE_COOKIE)?.value);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

function hasControl(s: string): boolean {
  if (CONTROL.test(s)) return true;
  try {
    return CONTROL.test(decodeURIComponent(s));
  } catch {
    return true;
  }
}

/** Same-origin relative path starting with a single `/`, else null. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next?.startsWith('/')) return null;
  if (next.startsWith('//') || next.startsWith('/\\')) return null;
  if (hasControl(next)) return null;
  return next;
}

function parse(next: string | null): { path: string; params: URLSearchParams } {
  const u = new URL(next ?? '/', 'http://x.invalid');
  return { path: u.pathname, params: u.searchParams };
}

function enc(segment: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch {
    return encodeURIComponent(segment);
  }
}

function pick(params: URLSearchParams, keys: string[]): string {
  const out = new URLSearchParams();
  for (const k of keys) {
    const v = params.get(k);
    if (v) out.set(k, v);
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}

export function modeTarget(to: UiMode, next: string | null): string {
  const { path, params } = parse(next);
  const seg = path.split('/').filter(Boolean);
  if (to === 'advanced') {
    if (seg[0] !== 's') return '/';
    if (seg[1] === 'subjects' && seg[2] && seg.length === 3)
      return `/subjects/${enc(seg[2])}${pick(params, ['class', 'group'])}`;
    if (seg[1] === 'plan' && seg.length === 2)
      return `/plan${pick(params, ['week'])}`;
    if (seg[1] === 'search' && seg.length === 2)
      return `/search${pick(params, ['q'])}`;
    if (seg[1] === 'reports' && seg.length === 2) {
      const r = params.get('r');
      if (r !== null && /^\d+$/.test(r)) {
        const q = EXAMPLE_QUERIES[Number(r)];
        if (q) return sqlHref('/sql', q.sql);
      }
    }
    return '/';
  }
  if (seg.length === 0) return '/s';
  if (seg[0] === 'subjects' && seg[1] && seg.length === 2)
    return `/s/subjects/${enc(seg[1])}${pick(params, ['class', 'group'])}`;
  if (seg[0] === 'plan' && seg.length === 1)
    return `/s/plan${pick(params, ['week'])}`;
  if (seg[0] === 'search' && seg.length === 1)
    return `/s/search${pick(params, ['q'])}`;
  return '/s';
}

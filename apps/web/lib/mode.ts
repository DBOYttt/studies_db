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

/**
 * `.`/`..` segments or a backslash in the path (also percent-encoded):
 * `/.//evil.com` or `/a/..//evil.com` normalise to the scheme-relative
 * `//evil.com`, so any caller that resolves the path would hand out another
 * origin. No page of the app needs them.
 */
function hasDotSegmentOrBackslash(path: string): boolean {
  const d = decodeURIComponent(path);
  if (d.includes('\\')) return true;
  return d.split('/').some((seg) => seg === '.' || seg === '..');
}

/** Same-origin relative path starting with a single `/`, else null. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next?.startsWith('/')) return null;
  if (next.startsWith('//') || next.startsWith('/\\')) return null;
  if (hasControl(next)) return null;
  try {
    const d = decodeURIComponent(next);
    if (d.startsWith('//') || d.startsWith('/\\')) return null;
    if (hasDotSegmentOrBackslash(next.split(/[?#]/, 1)[0])) return null;
  } catch {
    return null;
  }
  // Belt and braces: what a browser would make of it stays on this origin.
  const u = new URL(next, 'http://x.invalid');
  if (u.origin !== 'http://x.invalid' || u.pathname.startsWith('//')) {
    return null;
  }
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

/** `nowe`, `<id>` or `<id>/edytuj` below `/wydarzenia`, else null (the index itself is mapped by `modeTarget`). */
function eventPath(rest: string[]): string | null {
  if (
    rest.length === 1 &&
    (rest[0] === 'nowe' || /^[1-9]\d{0,9}$/.test(rest[0]))
  )
    return `/${rest[0]}`;
  if (
    rest.length === 2 &&
    /^[1-9]\d{0,9}$/.test(rest[0]) &&
    rest[1] === 'edytuj'
  )
    return `/${rest[0]}/edytuj`;
  return null;
}

function pick(params: URLSearchParams, keys: string[]): string {
  const out = new URLSearchParams();
  for (const k of keys) {
    const v = params.get(k);
    if (v) out.set(k, v);
  }
  // The semester choice travels with every mapped page.
  const sem = params.get('sem');
  if (sem !== null && /^([1-7]|all)$/.test(sem)) out.set('sem', sem);
  const s = out.toString();
  return s ? `?${s}` : '';
}

/** Does this (already safe) path belong to the simple view (`/s` or `/s/...`)? */
function isSimplePath(next: string): boolean {
  const path = next.split(/[?#]/, 1)[0];
  return path === '/s' || path.startsWith('/s/');
}

/**
 * Where `/mode?to=` lands. Any advanced path (including `/admin…`) is kept as
 * is when switching to advanced; switching to simple maps the few pages that
 * have a simple twin and sends everything else (e.g. `/admin…`, which has no
 * simple counterpart) to `/s`.
 */
export function modeTarget(to: UiMode, next: string | null): string {
  // Already in the target mode: stay exactly where the user is.
  const safe = safeNext(next);
  if (safe !== null && isSimplePath(safe) === (to === 'simple')) return safe;
  // A rejected `next` is not mapped either: it falls back to the start page.
  const { path, params } = parse(safe);
  const seg = path.split('/').filter(Boolean);
  if (to === 'advanced') {
    if (seg[0] !== 's') return '/';
    if (seg[1] === 'subjects' && seg[2] && seg.length === 3)
      return `/subjects/${enc(seg[2])}${pick(params, ['class', 'group'])}`;
    if (seg[1] === 'plan' && seg.length === 2)
      return `/plan${pick(params, ['week'])}`;
    if (seg[1] === 'search' && seg.length === 2)
      return `/search${pick(params, ['q'])}`;
    if (seg[1] === 'wydarzenia') {
      if (seg.length === 2) return `/wydarzenia${pick(params, ['page'])}`;
      const e = eventPath(seg.slice(2));
      if (e) return `/wydarzenia${e}`;
    }
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
  if (seg[0] === 'wydarzenia') {
    if (seg.length === 1) return `/s/wydarzenia${pick(params, ['page'])}`;
    const e = eventPath(seg.slice(1));
    if (e) return `/s/wydarzenia${e}`;
  }
  return '/s';
}

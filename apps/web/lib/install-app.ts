/**
 * Pure helpers of the Install app button (components/InstallAppButton.tsx)
 * and the in-app sign-in (components/PasteSignInLink.tsx). Import-free, so
 * client components and the auth callback route share them.
 */

/** Longest login token /auth/callback accepts (the bot's are 43 chars). */
export const MAX_TOKEN_LEN = 512;

export const SIGN_IN_LINK_ERROR = 'This is not a Studies DB sign-in link.';

export interface InstallEnv {
  ua: string;
  maxTouchPoints: number;
  /** Already running as the installed app. */
  standalone: boolean;
  /** Chromium fired `beforeinstallprompt` and the event was kept. */
  hasPrompt: boolean;
}

export type InstallMode = 'hidden' | 'prompt' | 'ios';

/** iPhone/iPod/iPad, including iPadOS, which sends a Mac user agent. */
function isIos(ua: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

/**
 * What the button does: open the browser's install dialog, show the iOS
 * Share → Add to Home Screen guide (iOS has no install API), or nothing.
 */
export function installMode(env: InstallEnv): InstallMode {
  if (env.standalone) return 'hidden';
  if (env.hasPrompt) return 'prompt';
  if (isIos(env.ua, env.maxTouchPoints)) return 'ios';
  return 'hidden';
}

/**
 * Safari itself, not another iOS browser (Chrome, Firefox, Edge… say who
 * they are in the UA). The guide tells those to open the page in Safari.
 */
export function isIosSafari(ua: string): boolean {
  return (
    /Version\/[\d.]+.*Safari\//.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo/.test(ua)
  );
}

const TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const validToken = (t: string | null): t is string =>
  t !== null && t.length <= MAX_TOKEN_LEN && TOKEN_RE.test(t);

/**
 * The in-app path for a pasted sign-in link, or null. Accepts the bot's link
 * on this origin (optionally with `next=/admin`, the only value it sends) or
 * a bare token; Discord's `<…>` wrapping and spaces are ignored. The callback
 * still shows its confirmation page and checks `next` itself.
 */
export function parseSignInLink(input: string, origin: string): string | null {
  const raw = input
    .trim()
    .replace(/^<(.*)>$/, '$1')
    .trim();
  if (!raw) return null;
  if (validToken(raw)) return `/auth/callback?token=${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== '/auth/callback') return null;
  const token = url.searchParams.get('token');
  if (!validToken(token)) return null;
  const next = url.searchParams.get('next');
  if (next !== null && next !== '/admin') return null;
  return `/auth/callback?token=${token}${next ? '&next=%2Fadmin' : ''}`;
}

/** Where a request whose session has ended is sent (see `/login-info`). */
export const SESSION_ENDED_PATH = '/login-info?expired=1';
export const SIGN_IN_PATH = '/login-info';

/**
 * Did this request come from a page that was already open in the browser?
 * Server Actions, RSC navigations and form posts only come from a loaded
 * page, so without a valid session they mean the session ended (signed out in
 * another tab, expired). A plain page load may just be a first visit.
 */
export function fromLoadedPage(headers: Headers, method = 'GET'): boolean {
  return (
    (method !== 'GET' && method !== 'HEAD') ||
    headers.has('next-action') ||
    headers.has('rsc')
  );
}

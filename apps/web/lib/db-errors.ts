import { connectionErrorMessage } from './sql-console';

/**
 * Message for a failed call on the read-only pool: errno 1226 becomes
 * "The server is busy", anything else the generic connection error (these are
 * fixed server-built queries, so raw DB messages are never shown).
 */
export const roErrorMessage = connectionErrorMessage;

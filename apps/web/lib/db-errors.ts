import { connectionErrorMessage } from './sql-console';

/**
 * Polish message for a failed call on the read-only pool: errno 1226 becomes
 * "Serwer jest zajęty", anything else the generic connection error (these are
 * fixed server-built queries, so raw DB messages are never shown).
 */
export const roErrorMessage = connectionErrorMessage;

/**
 * The events index (`/s/wydarzenia`, `/wydarzenia`): every upcoming event,
 * 25 per page, starting now. One query per page on the views pool, reading
 * one row more than the page to know whether a next page exists (no COUNT).
 */
import { listUpcomingEvents } from '@studies/db';
import type mysql from 'mysql2/promise';
import type { PlanSession } from './plan';

export const EVENTS_PER_PAGE = 25;
/** Deep pages read every row before them; past this the page is capped. */
export const MAX_EVENTS_PAGE = 400;

type SP = Record<string, string | string[] | undefined>;

/** `?page=` as a page number (1 when missing or invalid, at most the cap). */
export function parseEventsPage(sp: SP): number {
  const v = sp.page;
  if (typeof v !== 'string' || !/^[1-9]\d{0,8}$/.test(v)) return 1;
  return Math.min(Number(v), MAX_EVENTS_PAGE);
}

/** The index of the current mode, at `page`. */
export const eventsIndexHref = (simple: boolean, page: number): string =>
  `${simple ? '/s/wydarzenia' : '/wydarzenia'}${page > 1 ? `?page=${page}` : ''}`;

export interface EventsPage {
  events: PlanSession[];
  page: number;
  hasNext: boolean;
}

export async function upcomingEventsPage(
  pool: mysql.Pool,
  nowWall: Date,
  page: number,
): Promise<EventsPage> {
  const rows = await listUpcomingEvents(
    pool,
    nowWall,
    EVENTS_PER_PAGE + 1,
    (page - 1) * EVENTS_PER_PAGE,
  );
  return {
    events: rows.slice(0, EVENTS_PER_PAGE),
    page,
    hasNext: rows.length > EVENTS_PER_PAGE,
  };
}

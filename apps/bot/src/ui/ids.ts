/**
 * Component custom_id codec: `v1:<area>:<action>[:<arg>…]`, at most 100
 * characters. Anything that does not decode is a stale id (an old panel).
 */
import { MAX_ID } from './limits.js';

export type Area = 'stu' | 'adm';

const VERSION = 'v1';
const AREAS: readonly string[] = ['stu', 'adm'] satisfies Area[];

export function encodeId(
  area: Area,
  action: string,
  ...args: (string | number)[]
): string {
  const parts = [action, ...args.map(String)];
  if (!action) throw new Error('encodeId: empty action');
  for (const p of parts) {
    if (p.includes(':')) throw new Error(`encodeId: ':' in "${p}"`);
  }
  const id = [VERSION, area, ...parts].join(':');
  if (id.length > MAX_ID) {
    throw new Error(`encodeId: ${id.length} characters (max ${MAX_ID})`);
  }
  return id;
}

export function decodeId(
  id: string,
): { area: Area; action: string; args: string[] } | null {
  const [version, area, action, ...args] = id.split(':');
  if (version !== VERSION || !AREAS.includes(area) || !action) return null;
  return { area: area as Area, action, args };
}

import { plural } from './format';

/**
 * The result count of both searches: `4 files, 1 topic`. `cappedAt` (the
 * search's limit, when the list was cut there) adds that there may be more.
 */
export function searchCountText(
  files: number,
  topics: number,
  cappedAt?: number,
): string {
  const text = `${plural(files, 'file', 'files')}, ${plural(topics, 'topic', 'topics')}`;
  return cappedAt === undefined
    ? text
    : `${text} (the first ${cappedAt} results; there may be more)`;
}

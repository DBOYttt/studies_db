import { plural } from './format';

/** One shown search result: a file (`materialId`) or a topic-only hit. */
export type CountedHit = { materialId: number | null; topicId: number };

/**
 * The one counting rule of both searches, applied to the results a page
 * actually shows: each file once (by id), and the topic hits that are not a
 * file. Advanced passes its search hits, simple its file list.
 */
export function searchCounts(hits: readonly CountedHit[]): {
  files: number;
  topics: number;
} {
  const files = new Set<number>();
  const topics = new Set<number>();
  for (const h of hits) {
    if (h.materialId === null) topics.add(h.topicId);
    else files.add(h.materialId);
  }
  return { files: files.size, topics: topics.size };
}

/**
 * The result count of both searches: `4 files, 1 topic`, or `4 files` where
 * topics are not listed (simple). `cappedAt` (the search's limit, when the
 * list was cut there) adds that there may be more.
 */
export function searchCountText(
  files: number,
  topics?: number,
  cappedAt?: number,
): string {
  const text =
    topics === undefined
      ? plural(files, 'file', 'files')
      : `${plural(files, 'file', 'files')}, ${plural(topics, 'topic', 'topics')}`;
  return cappedAt === undefined
    ? text
    : `${text} (the first ${cappedAt} results; there may be more)`;
}

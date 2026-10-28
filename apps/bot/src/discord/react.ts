import type { Message } from 'discord.js';
import type { IngestResult } from '../ingest.js';

export async function reactForResult(
  message: Message,
  results: IngestResult[],
): Promise<void> {
  let emoji: string | null = null;
  if (results.includes('failed')) emoji = '❌';
  else if (results.includes('created')) emoji = '✅';
  else if (results.includes('duplicate')) emoji = '♻️';
  // A file over the size or volume limit was not stored (R3): say so too.
  const emojis = [
    ...(emoji ? [emoji] : []),
    ...(results.includes('skipped') ? ['⚠️'] : []),
  ];
  for (const e of emojis) {
    try {
      await message.react(e);
    } catch (err) {
      console.error(`could not react to message ${message.id}:`, err);
    }
  }
}

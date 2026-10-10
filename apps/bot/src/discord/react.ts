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
  if (!emoji) return;
  try {
    await message.react(emoji);
  } catch (err) {
    console.error(`could not react to message ${message.id}:`, err);
  }
}

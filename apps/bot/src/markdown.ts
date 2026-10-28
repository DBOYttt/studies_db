import { escapeMarkdown } from 'discord.js';

/**
 * Escapes user text for a message the bot posts: everything `escapeMarkdown`
 * handles by default plus masked links (`[text](url)` would show as a link
 * posted by the bot), headings, subtext, lists and block quotes. Raw URLs stay
 * clickable, but they show where they go.
 */
export function escapeUserText(text: string): string {
  // discord.js's `maskedLink` option is greedy (it escapes only the first of
  // several links), so every `[` is escaped here instead. `escapeMarkdown`
  // already escapes typed backslashes, so nothing is escaped twice.
  return escapeMarkdown(text, {
    heading: true,
    bulletedList: true,
    numberedList: true,
  })
    .replace(/\[/g, '\\[')
    .replace(/^(\s*)(>|-#)/gm, '$1\\$2');
}

import { escapeMarkdown } from 'discord.js';

/**
 * Escapes user text for a message the bot posts: everything `escapeMarkdown`
 * handles by default plus masked links (`[text](url)` would show as a link
 * posted by the bot), headings, subtext, lists and block quotes. Raw URLs stay
 * clickable, but they show where they go.
 */
export function escapeUserText(text: string): string {
  return escapeMarkdown(text, {
    maskedLink: true,
    heading: true,
    bulletedList: true,
    numberedList: true,
  }).replace(/^(\s*)(>|-#)/gm, '$1\\$2');
}

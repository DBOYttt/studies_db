import { MessageFlags } from 'discord.js';

const NO_MENTIONS = { parse: [] as never[] };

/** Reply options that never ping anyone, whatever the content contains. */
export function replyOptions(content: string): {
  content: string;
  allowedMentions: { parse: never[] };
};
export function replyOptions(
  content: string,
  ephemeral: true,
): {
  content: string;
  allowedMentions: { parse: never[] };
  flags: MessageFlags.Ephemeral;
};
export function replyOptions(content: string, ephemeral?: boolean) {
  return {
    content,
    allowedMentions: NO_MENTIONS,
    ...(ephemeral ? { flags: MessageFlags.Ephemeral as const } : {}),
  };
}

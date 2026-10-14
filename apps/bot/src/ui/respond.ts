/**
 * Acknowledging panel interactions and sending views, shared by the student
 * and admin handlers. Every payload disables mentions.
 */
import {
  type MessageComponentInteraction,
  MessageFlags,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { View } from './views/parts.js';

export type UiInteraction =
  | MessageComponentInteraction
  | ModalSubmitInteraction;

export const STALE_TEXT = 'Ten panel jest nieaktualny — otwórz go ponownie.';

export const NO_MENTIONS = { parse: [] as never[] };

/** A view as a new ephemeral message. */
export const ephemeral = (v: View) => ({
  components: v.components,
  flags: v.flags | MessageFlags.Ephemeral,
  allowedMentions: NO_MENTIONS,
});

/** The interaction came from an ephemeral (private) view, not a pinned panel. */
export const fromEphemeral = (i: UiInteraction) =>
  i.message?.flags.has(MessageFlags.Ephemeral) ?? false;

/**
 * Acknowledges within Discord's 3 s: a private view is updated in place;
 * a pinned panel (or `fresh`) gets a new ephemeral reply.
 */
export async function ack(i: UiInteraction, fresh = false): Promise<void> {
  if (!fresh && fromEphemeral(i)) await i.deferUpdate();
  else await i.deferReply({ flags: MessageFlags.Ephemeral });
}

/** Replaces the acknowledged response with a view. */
export async function show(i: UiInteraction, v: View): Promise<void> {
  await i.editReply({
    components: v.components,
    flags: v.flags,
    allowedMentions: NO_MENTIONS,
  });
}

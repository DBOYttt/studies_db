/**
 * Component and modal interactions (buttons, selects, modal submits) of the
 * panels. Errors propagate to createInteractionHandler, which reports them.
 */
import { users } from '@studies/db';
import {
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  MessageFlags,
  type ModalSubmitInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { memberRoleIds, syncAdminFlag } from '../admin-flag.js';
import type { RouterDeps } from '../commands/router.js';
import { toDiscordUser } from '../discord/map.js';
import { decodeId } from './ids.js';
import { parseStudentAction, runStudentAction } from './student.js';
import { notice, studentPanel, type View } from './views/student.js';

export type UiInteraction =
  | MessageComponentInteraction
  | ModalSubmitInteraction;

export const STALE_TEXT = 'Ten panel jest nieaktualny — otwórz go ponownie.';
export const BANNED_TEXT = 'Twój dostęp do strony jest zablokowany.';

const NO_MENTIONS = { parse: [] as never[] };

/** A view as a new ephemeral message. */
const ephemeral = (v: View) => ({
  components: v.components,
  flags: v.flags | MessageFlags.Ephemeral,
  allowedMentions: NO_MENTIONS,
});

/** /panel: the student panel, privately. Allowed for banned users too. */
export async function openStudentPanel(
  i: ChatInputCommandInteraction,
): Promise<void> {
  await i.reply(ephemeral(studentPanel()));
}

/** The interaction came from an ephemeral (private) view, not a pinned panel. */
const fromEphemeral = (i: UiInteraction) =>
  i.message?.flags.has(MessageFlags.Ephemeral) ?? false;

/**
 * Acknowledges within Discord's 3 s: a private view is updated in place;
 * a pinned panel (or `fresh`) gets a new ephemeral reply.
 */
async function ack(i: UiInteraction, fresh: boolean): Promise<void> {
  if (!fresh && fromEphemeral(i)) await i.deferUpdate();
  else await i.deferReply({ flags: MessageFlags.Ephemeral });
}

/** Replaces the acknowledged response with a view. */
async function show(i: UiInteraction, v: View): Promise<void> {
  await i.editReply({
    components: v.components,
    flags: v.flags,
    allowedMentions: NO_MENTIONS,
  });
}

async function isBanned(deps: RouterDeps, userId: number): Promise<boolean> {
  const [row] = await deps.ingest.db
    .select({ isBanned: users.isBanned })
    .from(users)
    .where(eq(users.id, userId));
  return row?.isBanned ?? false;
}

export async function handleUi(
  deps: RouterDeps,
  i: UiInteraction,
): Promise<void> {
  const id = decodeId(i.customId);
  const values = i.isStringSelectMenu() ? i.values : [];
  // Admin ids are not handled yet, so they are stale like any unknown id.
  const action =
    id?.area === 'stu' && !i.isModalSubmit()
      ? parseStudentAction(id.action, id.args, values)
      : null;
  if (!action) {
    await i.reply(ephemeral(notice(STALE_TEXT)));
    return;
  }

  // The login answer is a message of its own: keep the panel it came from.
  await ack(i, action.kind === 'login');
  const member = i.member;
  const { userId } = await syncAdminFlag(
    deps.ingest.db,
    toDiscordUser(i.user, member),
    memberRoleIds(i),
  );
  if (await isBanned(deps, userId)) {
    await show(i, notice(BANNED_TEXT));
    return;
  }
  await runStudentAction(
    { deps, user: i.user, member, userId, show: (v) => show(i, v) },
    action,
  );
}

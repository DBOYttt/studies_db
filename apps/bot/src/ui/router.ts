/**
 * Component and modal interactions (buttons, selects, modal submits) of the
 * panels. Errors propagate to createInteractionHandler, which reports them.
 */
import { users } from '@studies/db';
import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { memberRoleIds, syncAdminFlag } from '../admin-flag.js';
import type { RouterDeps } from '../commands/router.js';
import { toDiscordUser } from '../discord/map.js';
import { handleAdmin } from './admin.js';
import { handleEvent } from './events.js';
import { decodeId } from './ids.js';
import {
  ack,
  ephemeral,
  STALE_TEXT,
  show,
  type UiInteraction,
} from './respond.js';
import { parseStudentAction, runStudentAction } from './student.js';
import { adminPanel } from './views/admin.js';
import { notice, studentPanel } from './views/student.js';

export { STALE_TEXT, type UiInteraction } from './respond.js';

export const BANNED_TEXT = 'Twój dostęp do strony jest zablokowany.';

/** /panel: the student panel, privately. Allowed for banned users too. */
export async function openStudentPanel(
  i: ChatInputCommandInteraction,
): Promise<void> {
  await i.reply(ephemeral(studentPanel()));
}

/** /admin: the admin panel, privately (the command router checks the role). */
export async function openAdminPanel(
  i: ChatInputCommandInteraction,
): Promise<void> {
  await i.reply(ephemeral(adminPanel()));
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
  if (id?.area === 'adm') {
    await handleAdmin(deps, i, id.action, id.args);
    return;
  }
  if (id?.area === 'evt') {
    await handleEvent(deps, i, id.action, id.args);
    return;
  }
  const values = i.isStringSelectMenu() ? i.values : [];
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

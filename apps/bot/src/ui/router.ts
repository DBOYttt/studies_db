/**
 * Component and modal interactions (buttons, selects, modal submits) of the
 * panels. Errors propagate to createInteractionHandler, which reports them.
 */
import { clearDisabledReason, getReminderPrefs, users } from '@studies/db';
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
import {
  parseStudentAction,
  parseStudentModal,
  runStudentAction,
} from './student.js';
import { adminPanel } from './views/admin.js';
import { groupImportModal } from './views/modals.js';
import { notice, REMINDERS_OFF_NOTICE, studentPanel } from './views/student.js';

export { STALE_TEXT, type UiInteraction } from './respond.js';

export const BANNED_TEXT = 'Your access to the website is blocked.';

/** /panel: the student panel, privately. Allowed for banned users too. */
export async function openStudentPanel(
  i: ChatInputCommandInteraction,
  deps?: RouterDeps,
  userId?: number,
): Promise<void> {
  await i.reply(ephemeral(studentPanel()));
  if (deps && userId !== undefined) {
    await remindersOffNotice(deps, userId, (v) => i.followUp(ephemeral(v)));
  }
}

/**
 * Tells a user once that their reminders were turned off (closed DMs), then
 * forgets the reason; the prefs themselves stay off. Never throws.
 */
async function remindersOffNotice(
  deps: RouterDeps,
  userId: number,
  send: (v: ReturnType<typeof notice>) => Promise<unknown>,
): Promise<void> {
  try {
    const { db } = deps.ingest;
    const prefs = await getReminderPrefs(db, userId);
    if (!prefs.disabledReason) return;
    await clearDisabledReason(db, userId);
    await send(notice(REMINDERS_OFF_NOTICE));
  } catch (err) {
    console.error('reminders notice failed:', err);
  }
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
    id?.area !== 'stu'
      ? null
      : i.isModalSubmit()
        ? parseStudentModal(id.action, id.args, () =>
            i.fields.getTextInputValue('url'),
          )
        : parseStudentAction(id.action, id.args, values);
  if (!action) {
    await i.reply(ephemeral(notice(STALE_TEXT)));
    return;
  }

  // A modal must be the first response within 3 s, so it opens at once:
  // the submit's ban gate refuses a banned user before anything is fetched.
  if (action.kind === 'groupsImport') {
    if (i.isModalSubmit()) throw new Error('a modal cannot open a modal');
    await i.showModal(groupImportModal());
    return;
  }
  // The login answer and the import result are messages of their own: keep
  // the panel they came from.
  await ack(i, action.kind === 'login' || action.kind === 'groupsImportSubmit');
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
    {
      deps,
      user: i.user,
      member,
      userId,
      show: (v) => show(i, v),
      followUp: async (v) => {
        await i.followUp(ephemeral(v));
      },
    },
    action,
  );
  await remindersOffNotice(deps, userId, (v) => i.followUp(ephemeral(v)));
}

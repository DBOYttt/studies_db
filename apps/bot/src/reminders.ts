// Event reminders: a 1-minute tick that DMs the users who asked for them and
// posts the daily digest in the #wydarzenia forum. What is due, and the send
// log, live in `@studies/db` (`reminders.ts`); this file only sends and records.
// A tick never overlaps the previous one. Times are wall-clock Warsaw.
import {
  type Db,
  DIGEST_USER_ID,
  DM_DISABLED_REASON,
  type DueEntryQuiz,
  digestDay,
  disableReminders,
  dueDigest,
  dueDms,
  dueEntryQuizzes,
  EVENT_KINDS,
  getSetting,
  markSent,
  setSetting,
} from '@studies/db';
import { nowWall, type PlanSession } from '@studies/db/plan';
import {
  ChannelType,
  type Client,
  DiscordAPIError,
  RESTJSONErrorCodes,
} from 'discord.js';
import { EVENTS_FORUM_SETTING } from './config.js';
import { escapeUserText } from './markdown.js';

type Pool = Parameters<typeof dueDms>[1];

export const TICK_MS = 60_000;
/** bot_settings key of the long-lived digest ("Reminders") thread in #wydarzenia. */
export const DIGEST_THREAD_SETTING = 'events_digest_thread_id';
export const DIGEST_THREAD_NAME = '📅 Reminders';
/**
 * bot_settings key: the day (`YYYY-MM-DD`, the "tomorrow" of the digest)
 * whose entry quizzes were posted, so they go out once per day.
 */
export const DIGEST_QUIZ_SETTING = 'digest_quiz_date';
const MAX_MESSAGE = 2000;

/** The Discord operations the tick needs; `discordReminderGuild` is the real one. */
export interface ReminderGuild {
  /**
   * Throws on failure; a closed DM has `code` 50007, an id that is no
   * Discord snowflake throws `NotDiscordAccountError`.
   */
  sendDm(discordUserId: string, content: string): Promise<void>;
  /**
   * Posts `content` in the digest thread (reopening it), or creates the thread
   * in the forum when `threadId` is null or gone. Returns the thread id.
   */
  postDigest(
    forumId: string,
    threadId: string | null,
    content: string,
  ): Promise<string>;
}

/** What this process already delivered, so a DB failure never re-sends. */
export type ReminderMemory = {
  sent: Set<string>;
  digestThread: string | null;
  /** The digest day whose entry quizzes this process posted. */
  quizDate: string | null;
};
export const createReminderMemory = (): ReminderMemory => ({
  sent: new Set(),
  digestThread: null,
  quizDate: null,
});
const keyOf = (eventId: number, userId: number, kind: string, t: Date) =>
  `${eventId}:${userId}:${kind}:${t.getTime()}`;

export type ReminderDeps = {
  db: Db;
  memory?: ReminderMemory;
  /** True once the tick is shutting down; checked between sends. */
  isStopped?: () => boolean;
  pool: Pool;
  guild: ReminderGuild;
  webBaseUrl: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/** `Reminder: 📝 Test · Physics · tomorrow 10:00 · C-12` + link. */
export function dmText(
  e: PlanSession,
  kind: 'day' | 'hour',
  webBaseUrl: string,
): string {
  const when = e.allDay
    ? 'tomorrow (all day)'
    : `${kind === 'day' ? 'tomorrow' : 'today'} ${hm(e.startsAt)}`;
  const symbol = e.eventKind ? EVENT_KINDS[e.eventKind].symbol : '📌';
  const head = [
    `${symbol} ${escapeUserText(e.eventTitle ?? e.label)}`,
    e.subjectName ? escapeUserText(e.subjectName) : null,
    when,
    e.room ? escapeUserText(e.room) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `Reminder: ${head}\n${webBaseUrl}/s/wydarzenia/${e.id}`;
}

/** `Entry quiz: <subject>, <class> <group>` */
export const quizLine = (q: DueEntryQuiz) =>
  `Entry quiz: ${escapeUserText(q.subjectName)}, ${escapeUserText(
    [q.className, q.groupName].filter(Boolean).join(' '),
  )}`;

/**
 * `Tomorrow:`, a line per event, then a line per entry quiz; at most 2000
 * characters.
 */
export function digestText(
  events: PlanSession[],
  quizzes: DueEntryQuiz[] = [],
): string {
  const eventLines = events.map((e) => {
    const symbol = e.eventKind ? EVENT_KINDS[e.eventKind].symbol : '📌';
    return [
      `${symbol} ${escapeUserText(e.eventTitle ?? e.label)}`,
      e.subjectCode ? escapeUserText(e.subjectCode) : null,
      e.allDay ? 'all day' : hm(e.startsAt),
      e.room ? escapeUserText(e.room) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  });
  const lines = [...eventLines, ...quizzes.map(quizLine)];
  let out = 'Tomorrow:';
  for (let n = 0; n < lines.length; n++) {
    const rest = lines.length - n - 1;
    const next = `${out}\n${lines[n]}`;
    const tail = rest > 0 ? `\n…and ${rest} more` : '';
    if (next.length + tail.length > MAX_MESSAGE) {
      return `${out}\n…and ${lines.length - n} more`;
    }
    out = next;
  }
  return out;
}

/** `disabled_reason` of a user whose id is no Discord account (seed, QA, e2e). */
export const NOT_A_DISCORD_ACCOUNT = 'Not a Discord account';
const SNOWFLAKE = /^\d{17,20}$/;

/**
 * A DM to an id that is not a Discord snowflake (`seed-u1`, `qa-student`).
 * Discord would answer 400 Invalid Form Body, which looks transient.
 */
export class NotDiscordAccountError extends Error {
  constructor(discordUserId: string) {
    super(`not a Discord user id: ${discordUserId}`);
    this.name = 'NotDiscordAccountError';
  }
}

/** Why a DM can never be delivered to this user; null for transient errors. */
function undeliverableReason(err: unknown): string | null {
  if (err instanceof NotDiscordAccountError) return NOT_A_DISCORD_ACCOUNT;
  const code = (err as { code?: unknown } | null)?.code;
  if (code === RESTJSONErrorCodes.CannotSendMessagesToThisUser) {
    return DM_DISABLED_REASON;
  }
  if (code === RESTJSONErrorCodes.UnknownUser) return 'Unknown user';
  return null;
}

async function record(db: Db, entry: Parameters<typeof markSent>[1][number]) {
  try {
    await markSent(db, [entry]);
  } catch (err) {
    console.error('reminders: markSent failed (kept in memory):', err);
  }
}

async function sendDueDms(
  deps: ReminderDeps,
  memory: ReminderMemory,
  now: Date,
): Promise<void> {
  const { db, pool, guild, webBaseUrl } = deps;
  const due = await dueDms(db, pool, now);
  // A user whose DMs can't be delivered gets all their entries marked.
  const closed = new Set<number>();
  for (const d of due) {
    if (deps.isStopped?.()) return;
    const entry = {
      eventId: d.event.id,
      userId: d.userId,
      kind: d.kind,
      forStartsAt: d.event.startsAt,
    };
    const key = keyOf(d.event.id, d.userId, d.kind, d.event.startsAt);
    if (memory.sent.has(key)) {
      await record(db, entry);
      continue;
    }
    if (closed.has(d.userId)) {
      memory.sent.add(key);
      await record(db, entry);
      continue;
    }
    try {
      await guild.sendDm(d.discordUserId, dmText(d.event, d.kind, webBaseUrl));
    } catch (err) {
      const reason = undeliverableReason(err);
      if (reason === null) {
        console.error(
          `reminders: DM to ${d.discordUserId} failed, retrying next tick:`,
          err,
        );
        continue;
      }
      closed.add(d.userId);
      memory.sent.add(key);
      try {
        await disableReminders(db, d.userId, reason);
      } catch (e) {
        console.error('reminders: disableReminders failed:', e);
      }
      await record(db, entry);
      continue;
    }
    memory.sent.add(key);
    await record(db, entry);
  }
}

async function postDigest(
  deps: ReminderDeps,
  memory: ReminderMemory,
  now: Date,
): Promise<void> {
  const { db, pool, guild } = deps;
  const events = (await dueDigest(pool, now)).filter(
    (e) => !memory.sent.has(keyOf(e.id, DIGEST_USER_ID, 'digest', e.startsAt)),
  );
  // Entry quizzes go out once per digest day (the first message that day
  // carries them; events added later get their own lines only).
  const day = digestDay(now);
  const quizDay = day ? day.toISOString().slice(0, 10) : null;
  let quizzes: DueEntryQuiz[] = [];
  if (quizDay && memory.quizDate !== quizDay) {
    const found = await dueEntryQuizzes(pool, now);
    if (
      found.length > 0 &&
      (await getSetting(db, DIGEST_QUIZ_SETTING)) !== quizDay
    ) {
      quizzes = found;
    }
  }
  if (events.length === 0 && quizzes.length === 0) return;
  const forumId = await getSetting(db, EVENTS_FORUM_SETTING);
  if (!forumId) return;
  const stored = await getSetting(db, DIGEST_THREAD_SETTING);
  const threadId = stored ?? memory.digestThread;
  const posted = await guild.postDigest(
    forumId,
    threadId ?? null,
    digestText(events, quizzes),
  );
  memory.digestThread = posted;
  if (quizzes.length > 0 && quizDay) {
    memory.quizDate = quizDay;
    try {
      await setSetting(db, DIGEST_QUIZ_SETTING, quizDay);
    } catch (err) {
      console.error('reminders: saving the entry quiz digest day failed:', err);
    }
  }
  for (const e of events) {
    memory.sent.add(keyOf(e.id, DIGEST_USER_ID, 'digest', e.startsAt));
  }
  if (posted !== stored) {
    try {
      await setSetting(db, DIGEST_THREAD_SETTING, posted);
    } catch (err) {
      console.error('reminders: saving the digest thread failed:', err);
    }
  }
  await Promise.all(
    events.map((e) =>
      record(db, {
        eventId: e.id,
        userId: DIGEST_USER_ID,
        kind: 'digest' as const,
        forStartsAt: e.startsAt,
      }),
    ),
  );
}

/** One tick: DMs, then the digest. Failures are logged, never thrown. */
export async function runReminderTick(
  deps: ReminderDeps,
  now: Date = nowWall(),
): Promise<void> {
  const memory = deps.memory ?? createReminderMemory();
  try {
    await sendDueDms(deps, memory, now);
  } catch (err) {
    console.error('reminders (DM):', err);
  }
  try {
    await postDigest(deps, memory, now);
  } catch (err) {
    console.error('reminders (digest):', err);
  }
}

export function startReminderTick(
  deps: ReminderDeps,
  intervalMs = TICK_MS,
): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();
  const live: ReminderDeps = {
    ...deps,
    memory: deps.memory ?? createReminderMemory(),
    isStopped: () => stopped,
  };
  const tick = () => {
    running = runReminderTick(live).finally(() => {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    });
  };
  timer = setTimeout(tick, 0);
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}

export function discordReminderGuild(client: Client): ReminderGuild {
  const NO_MENTIONS = { parse: [] as never[] };
  return {
    async sendDm(discordUserId, content) {
      if (!SNOWFLAKE.test(discordUserId)) {
        throw new NotDiscordAccountError(discordUserId);
      }
      const user = await client.users.fetch(discordUserId);
      await user.send({ content, allowedMentions: NO_MENTIONS });
    },
    async postDigest(forumId, threadId, content) {
      if (threadId) {
        try {
          const c = await client.channels.fetch(threadId);
          if (c?.isThread()) {
            if (c.archived) await c.setArchived(false);
            await c.send({ content, allowedMentions: NO_MENTIONS });
            return threadId;
          }
        } catch (err) {
          const gone =
            err instanceof DiscordAPIError &&
            (err.code === RESTJSONErrorCodes.UnknownChannel ||
              err.code === RESTJSONErrorCodes.UnknownMessage);
          if (!gone) throw err;
        }
      }
      const forum = await client.channels.fetch(forumId);
      if (forum?.type !== ChannelType.GuildForum) {
        throw new Error(`channel ${forumId} is not a forum`);
      }
      const t = await forum.threads.create({
        name: DIGEST_THREAD_NAME,
        message: { content, allowedMentions: NO_MENTIONS },
      });
      return t.id;
    },
  };
}

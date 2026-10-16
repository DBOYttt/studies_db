// Event reminders: a 1-minute tick that DMs the users who asked for them and
// posts the daily digest in the #wydarzenia forum. What is due, and the send
// log, live in `@studies/db` (`reminders.ts`); this file only sends and records.
// A tick never overlaps the previous one. Times are wall-clock Warsaw.
import {
  type Db,
  DIGEST_USER_ID,
  DM_DISABLED_REASON,
  disableReminders,
  dueDigest,
  dueDms,
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

type Pool = Parameters<typeof dueDms>[1];

export const TICK_MS = 60_000;
/** bot_settings key of the long-lived "Przypomnienia" thread in #wydarzenia. */
export const DIGEST_THREAD_SETTING = 'events_digest_thread_id';
export const DIGEST_THREAD_NAME = '📅 Przypomnienia';
const MAX_MESSAGE = 2000;

/** The Discord operations the tick needs; `discordReminderGuild` is the real one. */
export interface ReminderGuild {
  /** Throws on failure; a closed DM has `code` 50007. */
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

export type ReminderDeps = {
  db: Db;
  pool: Pool;
  guild: ReminderGuild;
  webBaseUrl: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/** `Przypomnienie: 📝 Kolokwium · Fizyka · jutro 10:00 · C-12` + link. */
export function dmText(
  e: PlanSession,
  kind: 'day' | 'hour',
  webBaseUrl: string,
): string {
  const when = e.allDay
    ? 'jutro (cały dzień)'
    : `${kind === 'day' ? 'jutro' : 'dziś'} ${hm(e.startsAt)}`;
  const symbol = e.eventKind ? EVENT_KINDS[e.eventKind].symbol : '📌';
  const head = [
    `${symbol} ${e.eventTitle ?? e.label}`,
    e.subjectName || null,
    when,
    e.room || null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `Przypomnienie: ${head}\n${webBaseUrl}/s/wydarzenia/${e.id}`;
}

/** `Jutro:` and a line per event, at most 2000 characters. */
export function digestText(events: PlanSession[]): string {
  const lines = events.map((e) => {
    const symbol = e.eventKind ? EVENT_KINDS[e.eventKind].symbol : '📌';
    return [
      `${symbol} ${e.eventTitle ?? e.label}`,
      e.subjectCode || null,
      e.allDay ? 'cały dzień' : hm(e.startsAt),
      e.room || null,
    ]
      .filter(Boolean)
      .join(' · ');
  });
  let out = 'Jutro:';
  for (let n = 0; n < lines.length; n++) {
    const rest = lines.length - n - 1;
    const next = `${out}\n${lines[n]}`;
    const tail = rest > 0 ? `\n…i ${rest} więcej` : '';
    if (next.length + tail.length > MAX_MESSAGE) {
      return `${out}\n…i ${lines.length - n} więcej`;
    }
    out = next;
  }
  return out;
}

const isClosedDm = (err: unknown) =>
  (err as { code?: unknown } | null)?.code ===
  RESTJSONErrorCodes.CannotSendMessagesToThisUser;

async function sendDueDms(deps: ReminderDeps, now: Date): Promise<void> {
  const { db, pool, guild, webBaseUrl } = deps;
  const due = await dueDms(db, pool, now);
  // A user whose DMs are closed gets all their entries marked, not retried.
  const closed = new Set<number>();
  for (const d of due) {
    const entry = {
      eventId: d.event.id,
      userId: d.userId,
      kind: d.kind,
      forStartsAt: d.event.startsAt,
    };
    if (closed.has(d.userId)) {
      await markSent(db, [entry]);
      continue;
    }
    try {
      await guild.sendDm(d.discordUserId, dmText(d.event, d.kind, webBaseUrl));
    } catch (err) {
      if (isClosedDm(err)) {
        closed.add(d.userId);
        await disableReminders(db, d.userId, DM_DISABLED_REASON);
        await markSent(db, [entry]);
      } else {
        console.error(
          `reminders: DM to ${d.discordUserId} failed, retrying next tick:`,
          err,
        );
      }
      continue;
    }
    await markSent(db, [entry]);
  }
}

async function postDigest(deps: ReminderDeps, now: Date): Promise<void> {
  const { db, pool, guild } = deps;
  const events = await dueDigest(pool, now);
  if (events.length === 0) return;
  const forumId = await getSetting(db, EVENTS_FORUM_SETTING);
  if (!forumId) return;
  const threadId = await getSetting(db, DIGEST_THREAD_SETTING);
  const posted = await guild.postDigest(
    forumId,
    threadId ?? null,
    digestText(events),
  );
  if (posted !== threadId) await setSetting(db, DIGEST_THREAD_SETTING, posted);
  await markSent(
    db,
    events.map((e) => ({
      eventId: e.id,
      userId: DIGEST_USER_ID,
      kind: 'digest' as const,
      forStartsAt: e.startsAt,
    })),
  );
}

/** One tick: DMs, then the digest. Failures are logged, never thrown. */
export async function runReminderTick(
  deps: ReminderDeps,
  now: Date = nowWall(),
): Promise<void> {
  try {
    await sendDueDms(deps, now);
  } catch (err) {
    console.error('reminders (DM):', err);
  }
  try {
    await postDigest(deps, now);
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
  const tick = () => {
    running = runReminderTick(deps).finally(() => {
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

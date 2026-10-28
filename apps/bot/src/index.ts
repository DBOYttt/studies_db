import {
  createDb,
  enqueueMissingEventPosts,
  resolveStorageDir,
} from '@studies/db';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { catchUp, discordForumSource } from './catchup.js';
import { createInteractionHandler } from './commands/router.js';
import { type BotConfig, loadConfig } from './config.js';
import { registerEvents } from './discord/events.js';
import { fetchAttachmentBody } from './discord/map.js';
import { discordEventPostGuild, eventForumCheck } from './events/posts.js';
import {
  enqueueRenameRetry,
  recoverInterruptedRequests,
  startEventPoller,
} from './events/worker.js';
import { discordReminderGuild, startReminderTick } from './reminders.js';

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

let config: BotConfig;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const { db, pool } = createDb(config.databaseUrl);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
  allowedMentions: { parse: [] },
});

const ingest = {
  db,
  storageDir: resolveStorageDir(config.storageDir),
  fetchBody: fetchAttachmentBody,
};

registerEvents(client, ingest);
client.on(
  Events.InteractionCreate,
  (i) => void createInteractionHandler({ ingest, client, config, pool })(i),
);

let eventPoller: ReturnType<typeof startEventPoller> | undefined;
let eventPostGuild: ReturnType<typeof discordEventPostGuild> | undefined;
let reminderTick: ReturnType<typeof startReminderTick> | undefined;
client.once(Events.ClientReady, async (c) => {
  console.log(`Bot gotowy jako ${c.user.tag}`);
  // Requests left `running` by a previous process will never finish: fail
  // them before the poller starts.
  try {
    const n = await recoverInterruptedRequests(db);
    if (n > 0) console.log(`Przerwane zlecenia: ${n}.`);
  } catch (err) {
    console.error('recoverInterruptedRequests:', err);
  }
  // Failed or interrupted post requests are never retried on their own.
  try {
    const n = await enqueueMissingEventPosts(db);
    if (n > 0) console.log(`Brakujące posty wydarzeń: ${n}.`);
  } catch (err) {
    console.error('enqueueMissingEventPosts:', err);
  }
  eventPostGuild = discordEventPostGuild(client, eventForumCheck(db), {
    guildId: config.discordGuildId,
    retryRename: (threadId) => enqueueRenameRetry(db, threadId),
  });
  eventPoller = startEventPoller({
    db,
    guild: eventPostGuild,
    webBaseUrl: config.webBaseUrl,
    storageDir: ingest.storageDir,
  });
  reminderTick = startReminderTick({
    db,
    pool,
    guild: discordReminderGuild(client),
    webBaseUrl: config.webBaseUrl,
  });
  catchUp(ingest, discordForumSource(client, config.discordGuildId), {
    ignoreWatermark: false,
  }).then(
    (r) =>
      console.log(
        `Catch-up: ${r.topics} topics, ${r.created} new files, ${r.failed} errors.`,
      ),
    (err) => console.error('Catch-up failed:', err),
  );
});

const STOP_TIMEOUT_MS = 8_000;
let shuttingDown = false;
async function shutdown(code: number): Promise<never> {
  if (!shuttingDown) {
    shuttingDown = true;
    eventPostGuild?.dispose();
    try {
      // Both loops stop between steps; don't let a slow Discord call hold
      // the shutdown past the container's grace period.
      const stopped = Promise.all([eventPoller?.stop(), reminderTick?.stop()]);
      const timedOut = await Promise.race([
        stopped.then(() => false),
        new Promise<boolean>((r) =>
          setTimeout(() => r(true), STOP_TIMEOUT_MS).unref(),
        ),
      ]);
      if (timedOut)
        console.error('Zamykanie: zadania nie skończyły się w czasie.');
      await client.destroy();
      await pool.end();
    } catch (err) {
      console.error('Błąd podczas zamykania:', err);
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

try {
  await client.login(config.discordToken);
} catch (err) {
  console.error(
    `Could not log in the bot: ${err instanceof Error ? err.message : err}`,
  );
  await shutdown(1);
}

import { createDb, resolveStorageDir } from '@studies/db';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { catchUp, discordForumSource } from './catchup.js';
import { createInteractionHandler } from './commands/router.js';
import { type BotConfig, loadConfig } from './config.js';
import { registerEvents } from './discord/events.js';
import { fetchAttachmentBody } from './discord/map.js';

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

client.once(Events.ClientReady, (c) => {
  console.log(`Bot gotowy jako ${c.user.tag}`);
  catchUp(ingest, discordForumSource(client), { ignoreWatermark: false }).then(
    (r) =>
      console.log(
        `Catch-up: ${r.topics} tematów, ${r.created} nowych plików, ${r.failed} błędów.`,
      ),
    (err) => console.error('Catch-up nie powiódł się:', err),
  );
});

let shuttingDown = false;
async function shutdown(code: number): Promise<never> {
  if (!shuttingDown) {
    shuttingDown = true;
    try {
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
    `Nie udało się zalogować bota: ${err instanceof Error ? err.message : err}`,
  );
  await shutdown(1);
}

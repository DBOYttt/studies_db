# @studies/bot

Discord bot that mirrors forum channels (one per subject) into the Studies DB:
topics, attachments (deduplicated by hash), slash commands and one-time web login links.

## Setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. In **Bot**, copy the token (`DISCORD_TOKEN`) and enable the **Message Content** privileged intent.
3. Copy the Application ID (`DISCORD_CLIENT_ID`); copy your server ID (`DISCORD_GUILD_ID`) and the admin role ID (`ADMIN_ROLE_ID`) with Developer Mode on.
4. Invite the bot with scopes `bot applications.commands` and permissions: View Channels, Read Message History, Add Reactions, Send Messages in Threads:
   `https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot%20applications.commands&permissions=274877973568`
   (= View Channels + Read Message History + Add Reactions + Send Messages in Threads).
5. Create forum channels with the tags Wykład, Laboratorium, Ćwiczenia, Kolokwium, Egzamin.
6. Fill the bot variables in `.env` (see `.env.example`), start the DB (`pnpm db:up && pnpm db:migrate`).
7. Register slash commands: `pnpm --filter @studies/bot register`.
8. Run: `pnpm dev:bot` (watch mode) or `pnpm --filter @studies/bot start`.

A relative `STORAGE_DIR` is resolved against the repo root (not the current directory).

Missing env vars make the process exit with `Missing env: ...`; a login failure logs
`Nie udało się zalogować bota: ...` and exits with code 1.

## Manual end-to-end checklist (private test server)

> **Not verified live.** The bot has only been tested against fakes and the test DB; this checklist is the first real run on a live server.

1. `/subject add` for a forum channel -> OK reply.
2. New post with a PDF in the starter message -> reaction OK, row in `materials`.
3. Same PDF in another post -> duplicate reaction.
4. Stop the bot, post a DOCX, start the bot -> file ingested by catch-up (`Catch-up: ...` log line).
5. Delete the message -> `deleted_at` set.
6. `/link` -> DM with the login link received.
7. Delete a post that has been archived for more than 4 h -> its materials are hidden on the site (raw gateway events cover uncached threads).
8. Create a post as a new student -> `topics.created_by` is set (not NULL).
9. `/subject add` on a forum the bot cannot see -> ephemeral warning about View Channel / Read Message History.

Note: if the gateway connection is down while the bot runs, events in that window are missed;
recover by restarting the bot (startup catch-up) or running `/resync`.

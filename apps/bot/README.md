# @studies/bot

Discord bot that mirrors forum channels (one per subject) into the Studies DB:
topics, attachments (deduplicated by hash), slash commands and one-time web login links.
`/setup` builds the Discord side (categories, forums, tags, admin role) from the DB.

## Setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. In **Bot**, copy the token (`DISCORD_TOKEN`) and enable the **Message Content** privileged intent.
3. Copy the Application ID (`DISCORD_CLIENT_ID`) and your server ID (`DISCORD_GUILD_ID`, Developer Mode on).
   Admin commands are allowed for the admin role that `/setup` pins by id in the DB (`bot_settings`). On its
   first run `/setup` adopts the role named `ADMIN_ROLE_NAME` (default `Studies Admin`) or creates it; renaming
   the role later is fine. Until `/setup` has run, only `/setup` works (for members with Manage Server). If several
   roles share the name, `/setup` warns and pins nothing; keep one and run it again.
   The same role also sets `users.is_admin` for web users: the bot syncs the flag from members holding the pinned role,
   which unlocks the web admin panel (`/admin`, SQL write console and audit log).
   The flag is refreshed whenever the member runs a bot command, not when roles change: a member who leaves the
   server or loses the role keeps web admin until their next bot command (and web sessions last up to 30 days).
   When `/setup` pins a different role id than the stored one, it clears `is_admin` for everyone; holders of the
   new role get it back on their next command (the caller of `/setup` right away).
4. Invite the bot with scopes `bot applications.commands` and permissions: View Channels, Read Message History,
   Add Reactions, Send Messages, Send Messages in Threads, Attach Files, Manage Channels, Manage Threads (to pin
   the info post), Pin Messages (to pin the panels), Manage Roles:
   `https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot%20applications.commands&permissions=2252092139998288`
   A bot invited earlier without Pin Messages: grant it to the bot's role first, otherwise `/setup` cannot create
   `#panel` and `#admin-panel` (Discord refuses channel permission overwrites that grant a permission the bot
   doesn't have itself) and cannot pin the panels.
   In Server Settings → Roles, keep the bot's role above the admin role (Discord only lets a bot assign roles below its own).
5. Forum channels and their tags are created by `/setup` (step 9). Created by hand instead, each subject forum needs
   the tags Wykład, Laboratorium, Ćwiczenia, Projekt, Seminarium and Gr. 1 … Gr. N (one per group). A post tagged
   e.g. Laboratorium + Gr. 3 lands under that class/group; other tags (Kolokwium, Egzamin, ...) stay plain tags.
6. Fill the bot variables in `.env` (see `.env.example`), start the DB (`pnpm db:up && pnpm db:migrate`).
7. Register slash commands: `pnpm --filter @studies/bot register`. Re-run it after every change to the command
   definitions (`src/commands/definitions.ts`), e.g. after upgrading to a version with `/panel` and `/admin`.
   Run `pnpm db:migrate` first when upgrading (the panels use the `user_groups` table).
8. Run: `pnpm dev:bot` (watch mode) or `pnpm --filter @studies/bot start`.
9. In Discord, run `/setup dry_run:true` to preview, then `/setup`. Anyone with Manage Server (or the admin role)
   may run it. For every subject without a forum it creates a `Semestr N` category and a forum
   `<code>-<name>` with class/group tags and guidelines generated from the DB, and links it. Linked forums only get
   missing tags and refreshed guidelines (manual edits to the guidelines are overwritten). Nothing is ever deleted
   or renamed. A linked forum the bot cannot see is reported, never recreated. Re-running is safe; a second `/setup`
   while one is running is refused.
   It also works the other way: every forum on the server that no subject points to becomes a subject (code and
   name from the forum name, `asd-algorytmy` -> ASD / "Algorytmy"; semester from a `Semestr N` category, else 1;
   ECTS 0, fix with `/subject edit`). Class tags on forums (Laboratorium, Seminarium, ...) create missing classes.
   After an import `/setup` pulls the forums' posts (like `/resync`) and then adds their tags and guidelines.
   Topics that exist only in the DB are posted into their forum by the bot (title, class/group/plain tags, a
   `Dodane przez … (z bazy Studies DB)` starter message with the files; files over 10 MB are linked to the site
   instead) and the DB is re-linked to the new thread/messages, so deleting the post hides the files as usual.
   Each forum also gets a pinned `ℹ️ Informacje o przedmiocie` post (classes, lecturers with contacts, weekly
   plan for the next 14 days) that `/setup` refreshes on every run. Threads started by the bot are never
   turned into topics on their own.
   `/setup` also creates two text channels (inside the category of the first subject's forum, if any) with one pinned
   panel message each: `#panel` for students (everyone reads; only the bot posts, no reactions or threads; buttons for today's plan, the
   week, "Moje grupy" and the web login) and `#admin-panel` (only the admin role and the bot see it; status and
   sync, subjects, lecturers, users). Each run edits the panel message in place (and pins it if it isn't); a deleted
   message (or channel) is posted (created) again, never duplicated. A panel that can't be pinned is reported
   as a warning. The ids are kept in `bot_settings`. Everything the panels show
   is also available privately through `/panel` and `/admin`, and every admin change is checked against the admin
   role and written to the audit log.

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
10. `/lecturer assign` with `class` (and optionally `group`) -> reply "Przypisano prowadzącego do <KOD> / <Rodzaj>[, Gr. N].".
11. Tag a post Laboratorium + Gr. 3, then re-tag it Ćwiczenia -> it moves to Ćwiczenia with no group.
12. On a server without the admin role, `/setup dry_run:true` as the owner -> plan lists the role, categories and
    forums; nothing changes.
13. `/setup` -> role created and assigned to you, `Semestr N` categories, one forum per subject with tags and
    guidelines; `subjects.discord_channel_id` set.
14. `/setup` again -> only "panel w #panel" / "panel w #admin-panel" under Zaktualizowano (the panels are
    refreshed on every run); delete the `#panel` message and run `/setup` -> it is posted again, once.
15. Post in a created forum tagged Laboratorium + Gr. 1 with a PDF -> it lands under that class/group on the site.
16. Create a forum `fiz-fizyka` by hand with a tag Seminarium and one post with a PDF, run `/setup` -> subject FIZ
    with class Seminarium, the post and file are in the DB, the forum gets Kolokwium/Egzamin tags and guidelines.
17. Run `/setup` on a DB with topics/files and no posts -> every topic appears as a bot post with its files and
    tags, plus a pinned info post; `/setup` again -> no duplicates; delete one bot post -> its files vanish on
    the site.

Note: if the gateway connection is down while the bot runs, events in that window are missed;
recover by restarting the bot (startup catch-up) or running `/resync`.

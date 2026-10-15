# Admin panel, round 2: parity with the Discord admin commands

Date: 2026-10-14. Status: design approved in chat (inventory and order); waiting for the user to review this written spec.
Builds on round 1 (`docs/superpowers/specs/2026-10-13-admin-panel-round1-design.md`): `requireAdmin()`,
`admin_audit`, `/admin` tabs.

## Intent

The user said: "admin panel should have all option that discord admin can run". Every bot command that a Discord
admin can run must be available in the web panel, and every use from the web is written to the audit log. This
replaces the earlier round 2 (editor forms and schedule editing). Schedule editing, the rest of moderation and the
ops dashboard move to round 3.

Success: an admin can do everything below without opening Discord, and each change shows up in Dziennik.

| Discord command | Panel |
|---|---|
| `/subject add · edit · list` | Przedmioty: list, add form, edit form |
| `/lecturer add · edit · assign` | Prowadzący: list, add/edit form; assignment on the subject page |
| `/class edit` | Subject page: one form per class (assessment, note, platform URL) |
| `/plan sync · status` | Synchronizacja: status card and a "Synchronizuj plan" button |
| `/ban · /unban` | Użytkownicy: list with a ban/unban toggle |
| `/setup` (+ `dry_run`) | Synchronizacja: "Podgląd zmian" and "Uruchom /setup", run by the bot |
| `/resync` | Synchronizacja: "Pobierz z Discorda", run by the bot |

The web app and the bot still never call each other. Commands that need Discord go through a DB queue, the same
pattern as `/plan sync` uses with the worker.

## 1. Shared admin actions (`packages/db`)

> Shipped in the Discord GUI round (`docs/superpowers/specs/2026-10-14-discord-gui-design.md`): the actions live in
> `packages/db/src/admin-actions.ts` and back both the slash commands and the `#admin-panel` UI.

- Move the command logic from `apps/bot/src/commands/admin.ts` into `packages/db/src/admin-actions.ts`:
  `addSubject`, `editSubject`, `listSubjects`, `addLecturer`, `editLecturer`, `editClass`, `assignLecturer`,
  plus the field helpers (`textOrNull`, `urlOrNull`, `emailOrNull`) and the plan-sync reply text.
- Each action returns `{ ok: boolean; message: string }`. The message is the same Polish text the bot replies with
  today. The bot keeps replying with `message`; the web shows it as a toast or form error. Bot behaviour does not
  change, and the existing bot tests move with the code or keep passing through re-exports.
- `addSubject` accepts `channelId: string | null`. From the web a subject is created without a channel, and
  `/setup` then creates its forum. That is how the seed data already works. The bot still passes the picked
  channel and still runs `syncForumTags` afterwards.
- Ban/unban uses the existing `setBanned` (which also deletes sessions). The web refuses to ban the acting admin
  (`Nie możesz zablokować samego siebie.`).

## 2. Bot request queue

- Migration: `bot_requests`:
  - `id` int PK auto;
  - `kind` enum(`setup`, `setup_dry_run`, `resync`) NOT NULL;
  - `requested_by` int NOT NULL → users;
  - `status` enum(`queued`, `running`, `done`, `failed`, `cancelled`) NOT NULL DEFAULT `queued`;
  - `report` mediumtext NULL;
  - `created_at`, `started_at` NULL, `finished_at` NULL;
  - index on (`status`, `created_at`).
- The table is not in `PUBLIC_VIEWS` and not in `CONTENT_TABLES`, so the SQL console cannot touch it.
- `packages/db/src/bot-requests.ts`:
  - `enqueueBotRequest(db, kind, userId)` refuses when a request is already `queued` or `running`, and returns
    `{ ok: false, message: 'Bot już wykonuje zadanie.' }`;
  - `claimNextBotRequest(db)` uses `SELECT … FOR UPDATE SKIP LOCKED`, then sets `running` and `started_at`;
  - `finishBotRequest(db, id, status, report)`;
  - `cancelBotRequest(db, id)` works only while the request is `queued`;
  - `failStaleBotRequests(db, now)` marks `running` requests older than 15 minutes as `failed` with
    `Przerwano (restart bota).`;
  - `listBotRequests(db, limit)` returns requests newest first, with the requester's display name.
- Bot (`apps/bot/src/requests.ts`):
  - On startup it calls `failStaleBotRequests`, then polls every 5 s.
  - It runs one request at a time and shares the existing `setupRunning` lock with the slash command. While the
    lock is held, the poll skips.
  - `setup` / `setup_dry_run` run the same code as `/setup`. The guild comes from `DISCORD_GUILD_ID`, and the
    caller is the requester's Discord id. If the requester is not a guild member, the request fails with
    `Zlecający nie jest członkiem serwera.`.
  - `runSetup` is refactored to take `(deps, guild, callerId, dryRun)` and return the report text. The slash
    command and the poller both use it.
  - `resync` runs `catchUp` with `ignoreWatermark: true`.
  - The report is the same text the slash command would reply with. Any error marks the request `failed` with
    a short message, and the full error is logged.
- When a request from the web finishes, the bot writes an audit row (`bot.setup`, `bot.setup_dry_run`,
  `bot.resync`) with the outcome in `details`.

## 3. Audit

- Every web action writes `admin_audit` after it succeeds. The actions are `subject.add`, `subject.edit`,
  `lecturer.add`, `lecturer.edit`, `lecturer.assign`, `class.edit`, `plan.sync`, `user.ban`, `user.unban` and
  `bot.request`.
- `target` holds the subject code, lecturer id, Discord user id or request kind. `details` holds the submitted
  fields and `source: 'web'`.
- Slash commands also write the same actions with `source: 'discord'`, so Dziennik shows one history whichever
  side was used. This reuses the round 1 `writeAudit`. The bot already upserts the user. A failed audit write in
  the bot is logged and does not fail the command.
- Dziennik's action filter lists the new actions.

## 4. Web

New tabs in `adminTabs`, in this order:

| Tab | Path |
|---|---|
| Przegląd | `/admin` |
| Przedmioty | `/admin/subjects` |
| Prowadzący | `/admin/lecturers` |
| Użytkownicy | `/admin/users` |
| Synchronizacja | `/admin/sync` |
| SQL — zapis | `/admin/sql` |
| Dziennik | `/admin/audit` |

- **Przedmioty:**
  - The list shows code, name, semester, ECTS, whether a forum is linked, and the number of classes.
  - "Dodaj przedmiot" opens the add form (name, code, semester 1/2, ECTS, description).
  - The success message offers a link to Synchronizacja to create the forum.
  - `/admin/subjects/[code]` holds the edit form (name, semester, ECTS, description, platform URL) and one card
    per class (assessment, note, platform URL).
  - Each class card lists its assigned lecturers (with group) and has an "Przypisz prowadzącego" form (lecturer
    select, class kind, optional group number).
- **Prowadzący:**
  - The list shows title, name, e-mail, office hours and room.
  - The add form and the edit page `/admin/lecturers/[id]` use the same fields. An empty field means "clear"
    (the web equivalent of the bot's `-`).
- **Użytkownicy:**
  - The paged list (50 per page) shows display name, avatar, Discord id, admin flag, banned flag and the date the
    user first used the bot (`created_at`).
  - Search by name. A ban/unban button sits behind a confirm dialog.
  - The admin flag is read-only and comes from the Discord role (round 1).
- **Synchronizacja:**
  - The plan sync status card (same text as `/plan status`) with a "Synchronizuj plan" button.
  - Three bot buttons: "Podgląd zmian" (setup_dry_run), "Uruchom /setup" (with a confirm dialog) and
    "Pobierz z Discorda" (resync). They are disabled while a request is queued or running.
  - A request list with status, requester, times, and the report in a `<pre>` that can be expanded.
  - The page refreshes itself every 3 s while a request is queued or running (no websockets).
  - A queued request can be cancelled.
  - A request queued for more than 60 s shows "Bot nie odpowiada — czy działa?".
- Mutations are Next Server Actions in `app/(app)/admin/**/actions.ts`. Every action calls `requireAdmin()`
  itself; the layout alone is not a gate. Each action validates its input with the same rules as the bot
  (`semester` 1|2, ECTS 0–30, lengths as in `definitions.ts`, URL regex), calls the shared action, writes the
  audit row, and runs `revalidatePath`.
- Before writing code, the implementer reads the Server Actions guide in `apps/web/node_modules/next/dist/docs/`,
  because this Next version has breaking changes.
- UI is built with the taste skills (`redesign-existing-projects` / `minimalist-ui`) on the existing phpMyAdmin
  design tokens, light and dark, matching round 1 screens.

## Error handling

- Action results with `ok: false` are shown inline on the form and are not audited. DB errors are mapped through
  `lib/db-errors.ts`.
- A non-admin gets 404 on every new page. A Server Action called by a non-admin also ends in `notFound()`.
- Bot requests that fail keep their report and status. Nothing is retried automatically.

## Testing

- `packages/db`:
  - the moved action tests (same assertions as the bot tests today), and `addSubject` with a null channel;
  - bot-request queue: enqueue refuses a second active request; claim is exclusive (two concurrent claims → one
    row); cancel works only while queued; stale requests are failed.
- bot:
  - the poller runs setup/dry-run/resync through fakes and writes the report and audit row;
  - it skips while `setupRunning` is set;
  - a requester who is not a member gets a failed request with the message;
  - slash commands write `source: 'discord'` audit rows;
  - the existing `/setup` tests still pass after the `runSetup` refactor.
- web unit: input validation, `adminTabs`, ban refuses self, action → audit row (test DB).
- e2e:
  - the admin adds a subject, edits it, adds a lecturer, assigns them to a class, and edits the class;
  - they ban and unban a seeded user;
  - they queue a dry run and see it `queued` (no bot runs in e2e) and cancel it;
  - each step appears in Dziennik;
  - a non-admin gets 404 on every new page.
- Final review: `sql-console-security-reviewer` (web + queue table) and `discord-bot-reviewer` (poller,
  `runSetup` refactor) on the whole branch.

## Out of scope (round 3)

Schedule editing (move/cancel/add sessions protected from UniTime overwrites); hiding/restoring topics and files;
re-running jobs; ops dashboard; deleting subjects or lecturers (the bot cannot delete them either).

# Admin panel round 2: parity with the Discord admin commands (2026-10-29)

This spec supersedes `2026-10-14-admin-panel-round2-design.md`. Its intent is unchanged; the details follow the code as it is today.

- The shared actions already exist: `packages/db/src/admin-actions.ts`.
- The generic `bot_requests` queue already exists, used by the events feature.
- `runSetup` / `runResync` / `withSetupLock` already exist in `apps/bot/src/ops.ts` and are used by the slash commands and `#admin-panel`.
- UI strings are English (docs/glossary.md).

## Intent

The user said "admin panel should have all option that discord admin can run". Every bot admin command must also be available on the web `/admin`, and each use is written to `admin_audit`.

| Discord | Web |
|---|---|
| `/subject add · edit · list` | Subjects: list, add form, edit page |
| `/lecturer add · edit · assign` | Lecturers: list, add form, edit page; assign on the subject page |
| `/class edit` | Subject page: one form per class (assessment, note, platform URL) |
| `/plan sync · status` | Sync: status card and a "Sync timetable" button |
| `/ban · /unban` | Users: paged list with Block/Unblock |
| `/setup` (+ dry run) | Sync: "Preview changes" and "Run setup", carried out by the bot |
| `/resync` | Sync: "Fetch from Discord", carried out by the bot |

The web and the bot still never call each other. Requests that need Discord go through `bot_requests`.

## 1. Domain (packages/db)

- **Shared actions:**
  - Reuse `addSubject` (with `channelId: null` from the web; `/setup` then creates the forum), `editSubject`, `addLecturer`, `editLecturer`, `editClass`, `assignLecturer` and `banUser` as they are.
  - Their `{ ok, message }` English messages are shown as they are.
- **New read helpers:** these go in `packages/db/src/admin-lists.ts`, all plain Drizzle on the main pool:
  - `listSubjectsAdmin(db)`: code, name, semester, ECTS, forum linked (bool), class count, not deleted;
  - `getSubjectAdmin(db, code)`: the subject, its classes, each class's lecturer assignments (lecturer name, group name);
  - `listLecturersAdmin(db)`;
  - `getLecturerAdmin(db, id)`;
  - `listUsersAdmin(db, { q, limit: 50, offset })`: display name, Discord id, is_admin, is_banned, created_at; `q` matches display name or id with LIKE (escape `%`/`_`).
- **Admin bot requests:** new kinds `setup`, `setup_dry_run` and `resync`, with target `guild` and payload `{ requestedBy: <users.id> }`.
  - **Enqueue:** `enqueueAdminBotRequest(db, kind, userId)` refuses with `{ ok: false, message: 'The bot is already working on a request.' }` when any admin kind is `queued` or `running`. It checks inside a transaction with a locking read, then calls `enqueueBotRequest`.
  - **Cancel:** `cancelAdminBotRequest(db, id)` works only while the request is `queued`. It sets status `failed` with error `Cancelled.`; the status enum is left unchanged.
  - **List:** `listAdminBotRequests(db, limit = 20)` returns the requests newest first, each with its requester's display name.
- **Migration:** add a column `bot_requests.report MEDIUMTEXT NULL`. It holds the setup/resync report text (≤ 60 000 chars, truncated with `…`). Generate it with `drizzle-kit generate`. `finishBotRequest` gains an optional `report` argument.
- **Web plan sync:** "Sync timetable" uses the existing `requestPlanSync(db)` and `getPlanSyncStatus(db)`. The status card text matches the bot's `/plan status` reply. `planStatusText` moves from `apps/bot/src/commands/plan.ts` to `packages/db/src/unitime/status.ts` (the bot re-exports it).

## 2. Bot

- **The admin request poller:** `apps/bot/src/admin-requests.ts`, started next to the event poller.
  - **Polling:** every 5 s, it claims only the admin kinds (`claimNextBotRequest(db, ADMIN_REQUEST_KINDS)`), one at a time.
  - **Setup lock:** before claiming, it skips the tick if `withSetupLock` is busy. If a run starts after the claim and the lock is then busy, it finishes the request `failed` with `BUSY_TEXT`.
  - **Requester:** must still be an admin (`users.is_admin`) and a guild member. Otherwise the request fails with `The requester is no longer an admin.` or `The requester is not a member of the server.`
  - **What runs:** `setup` / `setup_dry_run` call `runSetup(deps, guild, requesterDiscordId, dryRun, audit)`; `resync` calls `runResync`. The report text is stored in `report`.
  - **Audit:** the `audit` callback writes `admin_audit` with the requester's user id, `source: 'web'` and `requestId`. The actions are the same ones the slash command writes.
- **At boot:** stale `running` admin requests are failed, the same way the existing `recoverInterruptedRequests` handles event kinds. Extend it or add a sibling.
- **Logging:** a failure stores a short English message, and the full error goes to the log.

## 3. Web

- **Tabs** (`components/shell/admin-tabs.ts`): Overview, Subjects, Lecturers, Users, Sync, SQL console, Audit log. Keep the existing labels for the existing tabs.
- **Pages:**
  - `/admin/subjects`
  - `/admin/subjects/[code]`
  - `/admin/lecturers`
  - `/admin/lecturers/[id]`
  - `/admin/users`
  - `/admin/sync`
  - Every page calls `requireAdmin()` and is `force-dynamic`.
- **Mutations:** these are Server Actions in `apps/web/lib/admin-actions.ts` (`'use server'`).
  - Every action calls `requireAdmin()` first.
  - It validates input with the bot's rules:
    - semester 1|2;
    - ECTS integer 0–30;
    - lengths from `FIELD_MAX` and the ranges in `apps/bot/src/commands/fields.ts`, which moves to `packages/db/src/admin-fields.ts` (the bot re-exports it);
    - URL via `urlOrNull`.
  - It calls the shared action and writes `admin_audit` only when `ok`. Actions: `subject.add`, `subject.edit`, `lecturer.add`, `lecturer.edit`, `lecturer.assign`, `class.edit`, `plan.sync`, `user.ban`, `user.unban`, `bot.request`, `bot.request_cancel`. Targets match what the bot writes today: the subject code (upper-case), the lecturer id as a string, the Discord user id, or `bot_request:<id>`, and `details` = the submitted fields + `source: 'web'`.
  - Then it calls `revalidatePath`.
  - An empty field means "clear", the web equivalent of the bot's `-`.
- **Ban rules:** banning yourself is refused with `You cannot block yourself.` Banning another admin is allowed (the bot allows it too).
- **Sync page:**
  - the plan sync card;
  - the three bot buttons, with "Run setup" behind a confirm. They use the `aria-disabled` pattern while a request is queued or running;
  - a list of requests: status, requester, times, error, and the report in an expandable `<pre>`;
  - "Cancel" on a queued request;
  - a request queued for more than 60 s shows `The bot is not responding. Is it running?`;
  - while one is active, a small client component calls `router.refresh()` every 3 s.
- **Audit log:** the action filter lists the new actions.
- **Design:**
  - Use the existing phpMyAdmin tokens and the round-1 screens' patterns (`box`, `boxHead`, `ScreenHeader`), in light and dark mode.
  - Implementers invoke the `redesign-existing-projects` / `minimalist-ui` skills before UI work and read the Next Server Actions guide in `apps/web/node_modules/next/dist/docs/`.
- **Language:** subject and class names stay as stored; everything else is English; `pnpm check:lang` passes.

## Error handling

- `ok: false` results show inline (`role="alert"`) and are not audited.
- A non-admin gets 404 on pages and actions (`requireAdmin` → `notFound()`).
- Failed bot requests keep their error and report and are not retried.

## Testing

- **db:**
  - the list helpers;
  - `enqueueAdminBotRequest`: it refuses while one is queued or running, and runs unaffected by event kinds;
  - cancel works only while queued;
  - `report` storage and truncation.
- **bot:**
  - the poller with fakes: setup, dry run and resync store the report and audit with `source: 'web'`;
  - it skips while the lock is busy;
  - a requester who is not an admin or not a member fails with the message;
  - event kinds are untouched.
- **web, unit:**
  - validation;
  - self-ban refused;
  - action → audit row (test DB);
  - non-admin → notFound.
- **e2e (admin):**
  - add a subject, edit it, add a lecturer, assign them, edit a class;
  - block and unblock a seeded user;
  - queue a dry run (it stays queued: no bot in e2e) and cancel it;
  - check that the audit log shows them;
  - a student gets 404 on each new page.
- **Final review:** `sql-console-security-reviewer` (the web side) and `discord-bot-reviewer` (the poller).

## Out of scope

Round 3 covers:
- schedule editing;
- hiding topics and files;
- re-running jobs;
- an ops dashboard;
- deleting subjects or lecturers.

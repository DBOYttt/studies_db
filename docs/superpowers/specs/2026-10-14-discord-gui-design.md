# Discord GUI: student and admin panels in the bot

Date: 2026-10-14. Status: design approved in chat (approach, student panel, admin panel, errors/testing); pending
review of this written spec.

## Intent

The user asked to "use discord gui on bot so it will have better and more useful panel for users and for admins".
Today every bot command answers with plain text and the bot uses no buttons, menus or forms. This round gives the
bot interactive panels built from Discord components.

Agreed in chat:

- **Students:**
  - Plan zajęć: today and this week, filtered to "Moje grupy";
  - Moje grupy;
  - a "Zaloguj się na stronie" button.
- **Admins:**
  - a sync and status card;
  - data editing forms (subjects, lecturers, classes, lecturer assignment);
  - user moderation (ban/unban);
  - a button that sends a login link straight to the web `/admin`.
- **Placement:**
  - `/setup` creates `#panel` (everyone, read-only) and `#admin-panel` (admin role only), each holding one
    permanent panel message;
  - buttons open private (ephemeral) views;
  - `/panel` and `/admin` open the same views from anywhere.
- **Groups:** "Moje grupy" is saved per user in the DB and shared by Discord and the web.
- **Order:** this round comes before web admin round 2
  (`docs/superpowers/specs/2026-10-14-admin-panel-round2-design.md`). Round 2 then reuses the shared admin
  actions moved here.
- **Approach:** Components V2 messages (containers, sections, text displays, separators, action rows) with
  stateless interaction routing. The state lives in each component's `custom_id`, so pinned panels keep working
  across bot restarts.

Success:

- A student opens `#panel`, picks their groups once, and from then on sees only their own classes, for any day or
  week, without leaving Discord. The web plan shows the same groups.
- An admin can do everything the admin slash commands do from `#admin-panel` with buttons, menus and forms.
- Every admin change from Discord appears in the web Dziennik.

## 1. Shared code moved to `packages/db`

- **Plan:** from `apps/web/lib/plan.ts` and `plan-queries.ts`, the DB-free and DB helpers both apps need move to
  `packages/db/src/plan.ts`:
  - ISO week helpers: `isoWeekOf`, `parseIsoWeek`, `formatIsoWeek`, `weekStart`, `shiftWeek`, `nowWall`;
  - the `PlanSession` type;
  - `listWeekSessions`, `listMyGroupOptions`, `filterMyGroups`, `sanitizeMyGroups`.
  
  The web re-exports or imports them. Behaviour and tests are unchanged: the tests move with the code.
- **Admin actions:** `apps/bot/src/commands/admin.ts` moves to `packages/db/src/admin-actions.ts`, exactly as in
  round 2 §1.
  - Each action returns `{ ok: boolean; message: string }`.
  - `addSubject` accepts `channelId: null`.
  - The slash commands keep their replies.
- **Groups:** a new table `user_groups`:
  - `user_id` → users (ON DELETE CASCADE), `class_id` → classes (CASCADE), `group_id` → class_groups (CASCADE);
  - PK (`user_id`, `class_id`).
  
  Helpers in `packages/db/src/my-groups.ts`:
  - `getMyGroups(db, userId): Promise<MyGroups>`;
  - `setMyGroup(db, userId, classId, groupId | null)`, where null deletes the entry; it refuses a group that does
    not belong to the class;
  - `clearMyGroups(db, userId)`;
  - `importMyGroups(db, userId, groups)`, which is used only when the user has no rows yet.
  
  The table is not in `PUBLIC_VIEWS` and not in `CONTENT_TABLES`.

## 2. Web changes

- **"Moje grupy" (`components/plan/useMyGroups.ts` and its callers):**
  - It reads the groups from the server: the page passes `getMyGroups` to the client component.
  - It saves through a Server Action that calls `requireUser()` and then `setMyGroup` / `clearMyGroups`.
  - On first load, if the DB has no groups and localStorage `studiesdb.myGroups.v1` has some, the client calls an
    import action once and then removes the key.
  - The advanced `/plan` and the simple `/s/plan` both use it.
- **Login `next`:**
  - `/auth/callback` (GET form and POST) accepts an optional `next`.
  - Only `/admin` or `/admin/...` is allowed, with no `//`, `\` or scheme; anything else becomes `/`.
  - When `next` starts with `/admin`, the callback also sets the mode cookie to `advanced`.
  - `createLoginToken` callers that issue admin links append `&next=%2Fadmin`.

## 3. Bot: UI modules

- **`apps/bot/src/ui/ids.ts`:**
  - `encodeId(area, action, ...args)` and `decodeId(customId)` give `v1:<area>:<action>:<args…>`, at most 100
    characters (Discord's limit).
  - Unknown versions, areas or actions decode to `null`.
- **`apps/bot/src/ui/views/*.ts`:** pure builders that return `{ components, flags }` with
  `MessageFlags.IsComponentsV2`:
  - `studentPanel()`, `planDay(sessions, day, hasGroups)`, `planWeek(sessions, week, hasGroups)`;
  - `groupsView(subjects, classesOfSelected, myGroups)`;
  - `adminPanel()`, `statusCard(status)`, `setupConfirm()`, `subjectPicker(page)`, `subjectCard(subject)`;
  - `lecturerPicker(page)`, `lecturerCard(lecturer)`, `userCard(user, self)`, `banConfirm(user, banned)`;
  - modal builders: `subjectModal(subject?)`, `classModal(cls)`, `lecturerModal(lecturer?)`, `assignModal(...)`.
  
  They take plain data and never touch the DB or discord.js clients, so they are unit-testable.
- **`apps/bot/src/ui/router.ts`:**
  - `handleComponent(i, deps)` handles buttons and selects; `handleModal(i, deps)` handles modal submits.
  - It decodes the id, runs `syncAdminFlag`, and checks the admin role (the same `isAdmin` as the commands) for
    every `admin` area id.
  - It loads data and replies:
    - `update` edits the private view in place;
    - `reply` with the Ephemeral flag opens a view from a pinned panel;
    - `showModal` opens a form.
  - Every admin change writes `admin_audit` with `source: 'discord'`, using the actions from round 2 §3
    (`subject.add`, `subject.edit`, …, `user.ban`, `user.unban`, `plan.sync`, `bot.setup`, `bot.resync`).
- **`apps/bot/src/index.ts`:** routes `isButton`, `isStringSelectMenu`, `isUserSelectMenu` and `isModalSubmit`
  to the UI router, next to the existing chat command routing.
- **New slash commands:**
  - `/panel` opens `studentPanel` privately;
  - `/admin` opens `adminPanel` privately (admin only).
  
  Both are added to `definitions.ts`, and `register` must be re-run.

## 4. Student panel

- **Pinned `#panel` message:** a title "📚 Studies DB", one line of text, and four buttons: **Plan dziś**,
  **Ten tydzień**, **Moje grupy** and **Zaloguj się na stronie**.
- **Day view:**
  - The title is "Plan — <weekday> <dd.mm>" in Europe/Warsaw time.
  - Each session is one section: time, subject code and name, class type and group, room, lecturer.
  - Buttons: ◀ · Dziś · ▶ · **Tydzień**, plus a link button **Otwórz na stronie** to `/s/plan?week=<iso>`.
- **Week view:**
  - One text block per day with a compact line per session.
  - Buttons: ◀ · ▶ for the week and **Dzień**, plus the same link button.
- **Filtering:**
  - With saved groups, the views show sessions without a group plus the user's groups (the same rule as the
    web's `filterMyGroups`).
  - Without saved groups, they show all sessions and the hint "Ustaw Moje grupy, aby widzieć tylko swoje zajęcia".
- **Limits:**
  - When the text would pass about 3500 characters or the 40-component limit, the view stops and adds
    "…i N więcej — otwórz na stronie".
  - An empty day shows "Brak zajęć".
- **Moje grupy view:**
  - A subject select lists only subjects that have classes with groups.
  - Then one select per such class (Laboratorium, Ćwiczenia, …) offers its groups plus "— brak —".
  - A choice is saved immediately with `setMyGroup`, and the view re-renders with a summary.
  - Buttons: **Wyczyść** and **Pokaż mój plan**.
- **Zaloguj się na stronie:** the same flow as `/link`: a DM with the one-time link, the same messages when DMs
  are closed or the user is banned.
- A banned user gets "Twój dostęp do strony jest zablokowany." for every student action.

## 5. Admin panel

- **Pinned `#admin-panel` message:**
  - Buttons: **Status i synchronizacja**, **Przedmioty**, **Prowadzący**, **Użytkownicy**, **Panel www**.
  - A non-admin who clicks any of them gets "Brak uprawnień." privately.
- **Status i synchronizacja:**
  - Shows the plan sync status (the same text as `/plan status`), job counts (queued, running, failed) and
    materials still `pending`.
  - Buttons:
    - **Synchronizuj plan**;
    - **Podgląd /setup**, which shows `formatPlan`;
    - **Uruchom /setup**, which opens `setupConfirm` with **Tak, uruchom** and **Anuluj**;
    - **Pobierz z Discorda** (`catchUp` with `ignoreWatermark`);
    - **Odśwież**.
  - Long runs `deferUpdate`, show "Pracuję…", then the report. They share the `setupRunning` lock with `/setup`,
    and while it is held the reply is "/setup już trwa — spróbuj za chwilę.".
  - `runSetup` is refactored to `(deps, guild, callerId, dryRun) → report text` and used by both the command and
    the panel.
- **Przedmioty:**
  - A subject select (25 per page, with ◀ ▶ page buttons) and **Dodaj przedmiot**, which opens a modal.
  - A subject card shows name, code, semester, ECTS, the forum link (or "brak forum"), and each class with its
    assessment and lecturers.
  - Card buttons: **Edytuj** (modal) and a class select, which gives **Edytuj zajęcia** (modal) and
    **Przypisz prowadzącego** (lecturer select, then a group select or "całe zajęcia").
  - After **Dodaj przedmiot**, the reply offers **Uruchom /setup** to create its forum.
- **Prowadzący:** a lecturer select (paged) and **Dodaj prowadzącego**; a lecturer card with **Edytuj** (modal).
- **Modals:**
  - They use text inputs with the same lengths as `definitions.ts`.
  - Semester and ECTS are validated as in the commands: semester 1|2, ECTS 0–30.
  - The assessment is a string select inside the modal (a Label component).
  - An invalid value replies privately with the same Polish message the command would.
- **Użytkownicy:**
  - A user select (Discord's member picker) leads to a user card: display name, admin flag, banned flag, first use.
  - Buttons: **Zablokuj** or **Odblokuj**, each with a confirm step. An admin cannot block themselves.
  - The user is upserted first, as `/ban` does.
- **Panel www:** a DM with a login link with `next=/admin`.

## 6. `/setup` additions

- The planner adds a text channel `panel` (everyone: view and read history, no send; bot: send and manage
  messages) and a text channel `admin-panel` (everyone: no view; admin role and bot: view; no send for the role).
  They go under the same category as the other channels, if there is one.
- The panel messages are kept in place:
  - their ids are stored in `bot_settings` as `panel_message_id` and `admin_panel_message_id`;
  - when the message exists, `/setup` edits it to the current layout;
  - when it is missing, `/setup` posts it again and stores the new id;
  - `/setup` never duplicates a panel.
- The existing planner and executor pattern (`plan.ts` actions, `apply.ts`, `SetupGuild`) gets new actions,
  `ensurePanelChannel` and `ensurePanelMessage`, with fakes in tests.

## Error handling

- A stale or unknown `custom_id` replies privately with "Ten panel jest nieaktualny — otwórz go ponownie.".
- Any thrown error is logged and answered privately with "Wystąpił błąd. Spróbuj ponownie później.", whether by
  reply or by followUp if the interaction was already acknowledged.
- Interactions that need DB work beyond one quick query acknowledge first (`deferUpdate` or ephemeral
  `deferReply`), so they stay within Discord's 3 s limit. Modals are shown without deferring, because Discord
  requires that.
- Every builder enforces Discord's limits: 25 options per select, 5 buttons per row, 40 components, and about
  4000 characters of text per message.
- The admin check runs on every admin interaction. The client-side placement in `#admin-panel` is never trusted.

## Testing

- **`packages/db`:**
  - the `user_groups` helpers: set, clear, import only when empty, and refusing a group of another class;
  - the moved plan helpers and admin actions keep their tests.
- **Bot unit tests:**
  - `ids` round-trip and limits, and stale ids;
  - each view builder:
    - day and week with and without groups, an empty day, the overflow cut-off;
    - group selects, the 25-option paging;
    - the setup and ban confirms;
    - component counts within limits.
  - router, with fake interactions:
    - an admin area id from a non-admin is refused;
    - every admin change writes one audit row with `source: 'discord'`;
    - a banned student is refused;
    - the `setupRunning` lock;
    - a modal with an invalid ECTS returns the Polish message;
  - `/setup` planner: creates the panel channels with the right overwrites, and edits rather than re-posts an
    existing panel message.
- **Web:**
  - unit tests for the `next` validation (allowed `/admin`, `/admin/sql`; refused `//evil`, `/\evil`,
    `https://…`, `/s`);
  - e2e: "Moje grupy" saved on `/s/plan` survives a new browser context (it is stored in the DB), and the
    localStorage import runs once.
- **Final review:**
  - `discord-bot-reviewer` checks interaction timing, limits and permissions;
  - `sql-console-security-reviewer` checks the callback `next`, the Server Actions and `user_groups`.

## Out of scope

- Editing the timetable from Discord (round 3).
- Material browsing or search panels (not chosen).
- Notifications and reminders.
- Deleting subjects or lecturers.
- A web UI for `user_groups` beyond the existing "Moje grupy" screen.

# Schedule Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let students add events to the plan (kolokwium, egzamin, wyjazd, extra lessons), each with its own
materials, from Discord and the web, plus recurring events, reminders and uploading files from the web.

**Architecture:**
- **Data and logic:** new `events` (one row per occurrence), `event_series`, `event_topics`, `reminder_prefs`,
  `reminder_log`, `web_uploads` and the generic `bot_requests` queue. All the logic lives in `packages/db`
  (`events.ts`, `event-series.ts`, `reminders.ts`, `bot-requests.ts`).
- **Plan display:** the web and the bot plan code merge class sessions and events.
- **Discord side:** the bot owns everything that touches Discord (event forum posts, reminders, posting web
  uploads). It consumes `bot_requests`.
- **Phases:** four, each ending in usable, tested software.
  1. Tasks 1–6: events.
  2. Tasks 7–8: recurring events.
  3. Tasks 9–10: reminders.
  4. Tasks 11–12: uploads.

**Tech Stack:** Drizzle + MariaDB, discord.js 14.27 (Components V2, modals with Label), Next.js 16 (Server Actions,
route handlers), @napi-rs/canvas (existing plan image), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-schedule-events-design.md`

## Global Constraints

- **Event kinds:** enum `kolokwium`, `egzamin`, `wyjazd`, `zajecia_dodatkowe`, `inne`.

  | Kind | Label | Symbol |
  |---|---|---|
  | `kolokwium` | Kolokwium | 📝 |
  | `egzamin` | Egzamin | 🎓 |
  | `wyjazd` | Wyjazd | 🚌 |
  | `zajecia_dodatkowe` | Zajęcia dodatkowe | ➕ |
  | `inne` | Inne | 📌 |

  Series symbol: 🔁. Keep them in one shared constant, `EVENT_KINDS` (label + symbol), in
  `packages/db/src/constants.ts`.
- **Field limits:** title 1–100 characters; place ≤ 100; note ≤ 1000; at most 20 linked posts per owner; a series
  has at most 30 occurrences within 1 year.
- **"Kiedy" format:** `DD.MM[.RRRR] [HH:MM[-HH:MM]]`.
  - With no year, use the nearest future date.
  - The end must be after the start.
  - Accepted range: now − 1 month … now + 1 year.
  - All-day events have `starts_at` 00:00 and `ends_at` NULL.
- **Time:** times are wall-clock Warsaw time, the same convention as `class_sessions` (UTC fields = local).
  Never convert time zones.
- **Rate limits:** 10 new events and 30 uploaded files per user per hour, counted from `admin_audit`.
- **Uploads:** ≤ 10 files, each ≤ 10 MB; temp files live in `STORAGE_DIR/uploads/`, contained with
  `resolveInStorage`, and are deleted after posting or after 24 h.
- **Reminders:**
  - DMs 24 h and 1 h before;
  - the digest goes out daily at 18:00 Warsaw time in `#wydarzenia`, never with @everyone;
  - catch-up after downtime only for reminders ≤ 30 min late;
  - deduplicated per (`event_id`, `user_id`, `kind`, `for_starts_at`).
- **Permissions:** wiki-style. Any logged-in user who isn't banned may add, edit or delete any event. Restore is
  admin only.
  - Web Server Actions and route handlers call `requireUser()` themselves and refuse banned users.
  - Bot handlers check the ban too.
- **Audit:** every event action writes `admin_audit`.
  - Actions: `event.add`, `event.edit`, `event.delete`, `event.restore`, `event.link`, `event.unlink`,
    `event.upload`, `reminders.update`.
  - `target` is the event id or `series:<id>`.
  - `details` carries `source: 'web' | 'discord'` and the changed fields.
- **Copy (Polish, verbatim from the spec):** "Post na Discordzie: w przygotowaniu", "Wydarzenie usunięte",
  "Nadchodzące wydarzenia", "Dodaj wydarzenie", "+ Wydarzenie", "Wydarzenia", "Materiały", "Dodaj pliki",
  "Tylko to", "To i następne", "Przypomnienia", "Jutro:", "DM zamknięte", "Plik od <nazwa> (przez stronę)",
  "Przypomnienie: …", "wysyłanie… / gotowe / błąd".
- **Repo rules:**
  - never `drizzle-kit push`;
  - generate migrations with `drizzle-kit generate`; views go in a `--custom` migration;
  - add `v_events` to `PUBLIC_VIEWS`, and `events`, `event_series`, `event_topics` to `CONTENT_TABLES`;
  - `reminder_prefs`, `reminder_log`, `web_uploads`, `bot_requests` go in neither;
  - tests use the TEST DB only;
  - every web page calls `requireUser()`;
  - the web client imports only from `@studies/db/plan` / `@studies/db/constants`, never the main index;
  - re-run `register` after changing command definitions (the controller does it, not tasks).
- **Discord limits:** modals ≤ 5 fields; selects ≤ 25 options; buttons ≤ 5 per row; ≤ 40 components;
  `custom_id` ≤ 100 in `v1:<area>:<action>…` (new area `evt`); every interaction acknowledged within 3 s;
  `allowedMentions: { parse: [] }`.

## Review Focus

1. **A date typed without a year near New Year** (`05.01` on 20.12) should land in next January, and `20.12` on
   05.01 should be refused (more than 1 month in the past), not silently put next year. Test in Task 2.
2. **The bot offline while a student creates or edits an event on the web:** the event appears immediately and
   the page says "Post na Discordzie: w przygotowaniu". When the bot starts, it creates exactly one post. Test in
   Task 5 (queue drained once; the duplicate guard holds).
3. **A banned user calling a Server Action or the upload route directly** (bypassing the hidden UI) must be
   refused with no side effect. Tests in Tasks 3 and 11.
4. **An event moved to another time after its reminder was sent** must be reminded again for the new time,
   exactly once, including after a bot restart. Tests in Task 9.
5. **An uploaded file name with a path or odd characters** (`../../x.pdf`, `ąę ł.pdf`, 255+ characters) must be
   stored safely under `uploads/` and posted to Discord under its original display name. Test in Task 11.

---

## Phase 1 — Events

### Task 1: Event tables, view, queue table, subject-less topics

**Files:**
- Modify: `packages/db/src/schema.ts` (add `events`, `eventTopics`, `botRequests`; `topics.subjectId` nullable),
  `packages/db/src/constants.ts` (`EVENT_KINDS`, `PUBLIC_VIEWS` += `v_events`, `CONTENT_TABLES` += `events`,
  `event_topics`)
- Create: migrations: one generated (tables plus the nullable column) and one custom (`v_events`); fix any
  TypeScript fallout from the nullable `topics.subjectId` in packages/db, the bot and the web, leaving behaviour
  unchanged for subject topics
- Test: `packages/db/test/events-schema.test.ts`; extend `readwrite-user.test.ts`; extend the readonly-user tests

**Interfaces:**
- Produces:
  - Tables:
    - `events`: the columns from spec §1 except `series_id`, which Task 7 adds;
    - `event_topics`: (`event_id`, `topic_id`) PK for now; Task 7 adds `series_id`;
    - `bot_requests`: `id`, `kind` varchar(40), `target` varchar(100), `status` enum(`queued`, `running`,
      `done`, `failed`), `payload` json NULL, `error` varchar(500) NULL, `created_at`, `started_at`,
      `finished_at`, and an index on (`status`, `created_at`).
  - `v_events`: non-deleted events plus `subject_code` and `subject_name` (LEFT JOIN).
  - `EVENT_KINDS: Record<EventKind, { label: string; symbol: string }>`.
  - `type EventKind`.

- [ ] **Step 1: Write failing tests:**
  - an event inserts with `subject_id` NULL;
  - a topic inserts with `subject_id` NULL;
  - `v_events` hides deleted rows and joins the subject code;
  - `studies_ro_test` can SELECT `v_events` but not `events`;
  - `studies_rw_test` can UPDATE `events` but cannot SELECT `bot_requests`.
- [ ] **Step 2: Run them.** `pnpm --filter @studies/db exec vitest run test/events-schema.test.ts
  test/readwrite-user.test.ts` → FAIL.
- [ ] **Step 3: Implement** the schema, migrations and constants, and fix the type fallout.
- [ ] **Step 4: Run** the db, bot and web suites one at a time, typecheck all, and lint → PASS.
- [ ] **Step 5: Commit** `feat(db): events, event_topics, bot_requests; topics may have no subject`.

### Task 2: Event logic and the request queue in `packages/db`

**Files:**
- Create: `packages/db/src/events.ts`, `packages/db/src/bot-requests.ts`; export them from `index.ts` (the
  pure `parseWhen` also goes in the `@studies/db/plan` subpath or a new client-safe subpath, for web form
  previews)
- Modify: `packages/db/src/plan.ts` (`PlanSession` gains `type: 'class' | 'event'` plus optional `eventKind`,
  `eventTitle`, `allDay`; `filterMyGroups` / `hiddenByMyGroups` treat events by the same rule)
- Test: `packages/db/test/events.test.ts`, `packages/db/test/bot-requests.test.ts`, and extend
  `plan-layout.test.ts` / `plan.test.ts`

**Interfaces:**
- Produces:
  - `parseWhen(text: string, now: Date): { ok: true; startsAt: Date; endsAt: Date | null; allDay: boolean } | { ok: false; message: string }`
  - `EventInput = { kind; title; subjectId: number | null; classId?: number | null; groupId?: number | null; when: string; place?: string | null; note?: string | null }`.
    `when` uses the "Kiedy" format; the web passes a composed string.
  - `addEvent(db, userId, input, source): Promise<ActionResult & { id?: number }>`. It validates, applies the
    rate limit, inserts, writes the `event.add` audit row and enqueues `event_post_upsert` with target
    `event:<id>`.
  - `editEvent(db, userId, eventId, patch, source)` enqueues an upsert.
  - `deleteEvent(db, userId, eventId, source)`: soft delete plus `event_post_archive`.
  - `restoreEvent(db, adminUserId, eventId)` plus an upsert.
  - `linkTopic(db, userId, eventId, topicId, source)` and `unlinkTopic(...)`. A topic must share the subject;
    any topic is allowed when the event has no subject; at most 20 links.
  - `listEventsInRange(pool, fromWall: Date, toWall: Date): Promise<PlanSession[]>` returns rows with
    `type: 'event'`.
  - `getEvent(db, id)` returns the event plus subject, creator and last editor names, and topic ids.
  - `eventMaterials(db, eventId): Promise<{ id; filename; topicTitle; createdAt; previewKind }[]>` covers the own
    post plus linked posts, without deleted ones, newest first.
  - `listUpcomingEvents(pool, nowWall, limit)`.
  - Banned users get `{ ok:false, message: 'Twój dostęp do strony jest zablokowany.' }` from every mutation.
  - Queue functions in `bot-requests.ts`:
    - `enqueueBotRequest(db, kind, target, payload?)` (no-op if one is already `queued` for the same kind and
      target);
    - `claimNextBotRequest(db, kinds: string[])` with `FOR UPDATE SKIP LOCKED`;
    - `finishBotRequest(db, id, 'done' | 'failed', error?)`;
    - `failStaleBotRequests(db, now, olderThanMs = 15 * 60_000)`;
    - `lastBotRequest(db, kind, target)`.

- [ ] **Step 1: Write failing tests**, with the spec's exact values:
  - **`parseWhen` with `now` = 2026-10-15 12:00:**
    - `20.10 10:00-11:30` → 2026-10-20 10:00–11:30;
    - `20.10` → all-day;
    - `05.01` → 2027-01-05;
    - `20.12.2026 08:00` → ok;
    - `10.09` → refused (more than 1 month in the past);
    - `20.10 12:00-11:00` → refused;
    - `32.10` → refused;
    - with `now` = 2026-12-20, `05.01` → 2027-01-05 (Review Focus 1).
  - **Validation:**
    - a title of 0 or 101 characters is refused;
    - a class of another subject is refused;
    - a group of another class is refused;
    - linking a topic of another subject is refused;
    - the 21st link is refused;
    - the 11th event within an hour is refused.
  - **Mutations:**
    - each writes one audit row with `source`;
    - a banned user is refused with no rows written.
  - **`eventMaterials`** returns own and linked files and excludes deleted ones.
  - **The Moje grupy rule for events:**
    - an event with a group is filtered like a class;
    - an event without a group is shown;
    - a hidden event is counted.
  - **The queue:**
    - claiming is exclusive (two concurrent claims → one row);
    - a duplicate `queued` request is a no-op;
    - a stale `running` request is failed.
- [ ] **Step 2: Run** `pnpm --filter @studies/db exec vitest run test/events.test.ts test/bot-requests.test.ts` →
  FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the db suite, typecheck db, bot and web, and lint → PASS.
- [ ] **Step 5: Commit** `feat(db): event logic, materials and the bot request queue`.

### Task 3: Web — event form, event page, Server Actions

**Files:**
- Create:
  - `apps/web/lib/event-actions.ts` (`'use server'`);
  - `apps/web/app/(simple)/s/wydarzenia/nowe/page.tsx`, `apps/web/app/(simple)/s/wydarzenia/[id]/page.tsx`,
    `apps/web/app/(simple)/s/wydarzenia/[id]/edytuj/page.tsx`;
  - the advanced equivalents under `apps/web/app/(app)/wydarzenia/…`;
  - `apps/web/components/events/EventForm.tsx`, `apps/web/components/events/EventDetails.tsx`.
- Modify: `apps/web/lib/mode.ts` (`modeTarget` maps `/s/wydarzenia/...` ↔ `/wydarzenia/...`)
- Test: `apps/web/test/event-actions.test.ts`, `apps/web/test/mode.test.ts`, `apps/web/e2e/events.spec.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `createEventAction(form: FormData)` redirects to the event page.
  - `updateEventAction(id, form)`.
  - `deleteEventAction(id)`.
  - `restoreEventAction(id)`, which calls `requireAdmin()`.
  - `linkTopicAction(id, topicId)` and `unlinkTopicAction(id, topicId)`.
  - `searchTopicsAction(subjectId | null, q)` returns ≤ 20 topics by title.
  - The form composes "Kiedy" from date, start and end inputs into the `parseWhen` format.
  - The event page shows:
    - the details, with "Post na Discordzie: w przygotowaniu" while `topic_id` is NULL, or the error text of a
      failed request;
    - "Materiały", using the existing `components/simple/FileList.tsx` rendering;
    - the linked posts;
    - **Edytuj** and **Usuń**; for admins, **Przywróć** on a deleted event;
    - "Historia", the event's audit rows.

- [ ] **Step 1: Write failing tests:**
  - **Unit:**
    - every action calls `requireUser`;
    - a banned user is refused with no rows (Review Focus 3);
    - invalid input returns the Polish message;
    - `restoreEventAction` returns 404 for a non-admin.
  - **e2e:**
    - add an event from "+ Wydarzenie";
    - it opens on its page with the "w przygotowaniu" line;
    - edit its title; link a seeded topic, and its files appear under Materiały;
    - delete it; it is gone from the page list and visible to an admin with Przywróć.
- [ ] **Step 2: Run** the tests → FAIL.
- [ ] **Step 3: Implement.** Read the Next 16 docs for Server Actions and forms first. Use the
  `redesign-existing-projects` / `minimalist-ui` skills on the existing design tokens.
- [ ] **Step 4: Run** the web unit suite, typecheck, lint, and `pnpm --filter @studies/web e2e e2e/events.spec.ts`
  → PASS.
- [ ] **Step 5: Commit** `feat(web): add, view, edit and delete events`.

### Task 4: Web — events in the plan, upcoming events, Dziennik filter

**Files:**
- Modify:
  - `apps/web/components/plan/WeekView.tsx` and `PlanWeekTab.tsx`: merge `listEventsInRange`; events are
    outlined blocks with the kind symbol, all-day events go in a strip above the hours, clicking opens the event
    page, and there is a "+ Wydarzenie" button;
  - `apps/web/app/(simple)/s/page.tsx`: a "Nadchodzące wydarzenia" card with the next 5 that match Moje groups;
  - `apps/web/app/(app)/admin/audit/page.tsx` and `apps/web/lib/admin-audit.ts`: a "Wszyscy / Admini" filter.
- Test: web unit tests for the merge and filter helpers; `apps/web/e2e/plan.spec.ts`, `events.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`listEventsInRange`, `listUpcomingEvents`, the Moje grupy rule).

- [ ] **Step 1: Write failing tests:**
  - an all-day event goes in the strip, not the grid;
  - a timed event is in the right column and row;
  - Moje grupy hides another group's event and counts it;
  - the start page lists 5 events in time order;
  - Dziennik "Admini" hides student rows.
- [ ] **Step 2–4: Run** → FAIL, implement, then the web suite, typecheck, lint, and e2e plan + events → PASS.
- [ ] **Step 5: Commit** `feat(web): events in the plan and on the start page; Dziennik filter`.

### Task 5: Bot — event forum posts through the queue; `#wydarzenia`

**Files:**
- Create:
  - `apps/bot/src/events/posts.ts`: an `EventPostGuild` interface with `createPost`, `editFirstMessage`,
    `archivePost` and `postExists`, plus a discord.js implementation;
  - `apps/bot/src/events/worker.ts`: the 5 s poller for `event_post_upsert` / `event_post_archive`.
- Modify:
  - `apps/bot/src/index.ts`: start the poller, and call `failStaleBotRequests` on boot;
  - `apps/bot/src/setup/*`: create the `wydarzenia` forum (everyone reads and posts) with a pinned info post;
    add the five kind tags to every subject forum and to `#wydarzenia`; store `events_forum_id` in
    `bot_settings`;
  - ingestion (`apps/bot/src/ingest.ts`, `discord/*`, `catchup.ts`): threads in `#wydarzenia` become topics with
    no subject.
- Test: `apps/bot/test/event-posts.test.ts`, `setup-plan.test.ts`, `setup-apply.test.ts`, and an ingestion test
  for a subject-less forum

**Interfaces:**
- Consumes: Task 2 (queue, `getEvent`), Task 1 (`bot_requests`).
- Post title: `<symbol> <Tytuł> — DD.MM`. The first message holds the details plus the web link
  `${webBaseUrl}/s/wydarzenia/<id>`. It is tagged with the kind tag.
- **Upsert:**
  - no `topic_id`, or the post is gone → create the post, insert its `topics` row (the event's subject, or NULL)
    and set `events.topic_id`;
  - the subject changed (the post's forum ≠ the target forum) → create a new post, turn the old topic into an
    `event_topics` link, and set the new `topic_id`;
  - otherwise → edit the title, the first message and the tag.
- **Archive:** edit the first message to "Wydarzenie usunięte", then archive and lock the thread.

- [ ] **Step 1: Write failing tests** (fakes):
  - creating an event and draining the queue gives exactly one post, and `topic_id` is set (Review Focus 2);
  - an edit changes the title and message;
  - a subject change gives a new post and the old one linked;
  - delete archives the post;
  - a deleted post is recreated on the next upsert;
  - a failure gives the request `failed` with a Polish error;
  - `/setup` plans the `#wydarzenia` forum and the kind tags only once (idempotent);
  - a file posted in `#wydarzenia` becomes a material of a topic with no subject.
- [ ] **Step 2–4: Run** → FAIL, implement, then the bot suite, typecheck and lint → PASS.
- [ ] **Step 5: Commit** `feat(bot): event forum posts via the request queue; #wydarzenia`.

### Task 6: Bot — add/edit/view events in Discord; events in the plan views and image

**Files:**
- Create: `apps/bot/src/ui/events.ts` (handlers), `apps/bot/src/ui/views/events.ts` (card, modal, list select)
- Modify:
  - `apps/bot/src/ui/router.ts`: area `evt`;
  - `apps/bot/src/ui/views/student.ts`: a 5th panel button `evt:new` "Dodaj wydarzenie"; the plan views get a
    "Wydarzenia" select, `evt:open`;
  - `apps/bot/src/ui/student.ts`: the plan merges `listEventsInRange`;
  - `apps/bot/src/ui/plan-image.ts`: events as outlined blocks with the kind symbol, all-day events in a strip;
  - `apps/bot/src/commands/definitions.ts` + `router.ts`: `/event add` with all options; `subject` uses
    autocomplete.
- Test: `apps/bot/test/ui-events.test.ts`, `ui-event-views.test.ts`, `plan-image.test.ts`, `ui-student-views.test.ts`

**Interfaces:**
- Consumes: Task 2 (actions return `ActionResult`), Task 5 (posts happen through the queue).
- **Modal `evt:save:new`:**
  - Rodzaj (select);
  - Tytuł;
  - Przedmiot (select with "— brak —" first; with more than 24 subjects, a text field for the code instead);
  - Kiedy;
  - Miejsce / notatka (first line = place).
- **Card buttons:**
  - `evt:grp:<id>` (class/group select);
  - `evt:link:<id>[:<page>]` (topic select, toggles);
  - `evt:edit:<id>` (modal `evt:save:<id>`);
  - `evt:del:<id>` → `evt:delok:<id>`;
  - link buttons Otwórz post / Otwórz na stronie.
- **Materiały:** up to 15 lines with web preview links, then "…i N więcej — otwórz na stronie".

- [ ] **Step 1: Write failing tests:**
  - the modal has 5 components;
  - the card stays within limits with 30 materials;
  - an invalid "Kiedy" gives the `parseWhen` message;
  - save writes an audit row with `source: 'discord'` and enqueues an upsert;
  - a banned user is refused;
  - the plan views list the period's events in the select;
  - the image draws an all-day strip and an outlined event block (pixel sample);
  - `/event add` with the repeat options is rejected until Phase 2 ("Powtarzanie będzie dostępne wkrótce").
- [ ] **Step 2–4: Run** → FAIL, implement, then the bot suite, typecheck and lint → PASS.
- [ ] **Step 5: Commit** `feat(bot): add and view events from Discord; events in the plan`.

## Phase 2 — Recurring events

### Task 7: Series in `packages/db`

**Files:** modify the schema (`event_series`, `events.series_id`, `event_topics.series_id` with a CHECK that
exactly one owner is set); a migration; `CONTENT_TABLES` += `event_series`; create
`packages/db/src/event-series.ts`. Test: `packages/db/test/event-series.test.ts`.

**Interfaces:**
- Produces:
  - `addSeries(db, userId, input & { rule: 'weekly' | 'biweekly'; until: string }, source)` generates the
    occurrences (≤ 30, ≤ 1 year after the first) and enqueues one upsert with target `series:<id>`.
  - `editEvent(..., scope: 'one' | 'following')` and `deleteEvent(..., scope)`. Editing "following" splits the
    series: the earlier occurrences keep the old series, and the later ones get a new series with the same post.
  - `eventMaterials` includes series links.

- [ ] **Step 1: Write failing tests:**
  - weekly from 20.10 until 15.12 gives 9 occurrences;
  - biweekly gives every other week;
  - 31 occurrences are refused with a message;
  - `until` earlier than the start is refused;
  - edit "one" changes only that occurrence;
  - edit "following" changes it and the later ones, not the earlier ones;
  - delete "following" soft-deletes them;
  - a series link shows in every occurrence's materials.
- [ ] **Step 2–4: Run** → FAIL, implement, then the db suite, typecheck and lint → PASS.
- [ ] **Step 5: Commit** `feat(db): recurring events`.

### Task 8: Series in the web and the bot

**Files:** the web form gets "Powtarzaj" (nie / co tydzień / co 2 tygodnie) plus "do"; edit and delete ask
"Tylko to" / "To i następne". The bot: `/event add` accepts `repeat` and `until`; the card's Usuń/Edytuj for a
series asks the scope; the series post is titled `🔁 <Tytuł> — co tydzień|co 2 tygodnie`. Tests are in the
existing web/bot event test files and `events.spec.ts`.

- [ ] **Step 1: Write failing tests:**
  - **e2e:** create a weekly event; it appears in 3 consecutive weeks; delete "To i następne" from week 2 leaves
    week 1;
  - **bot:** the scope prompt; the series post title; the queue upsert target is `series:<id>`.
- [ ] **Step 2–4: Run** → FAIL, implement, then the web and bot suites, typecheck, lint and e2e → PASS.
- [ ] **Step 5: Commit** `feat: recurring events on the web and in Discord`.

## Phase 3 — Reminders

### Task 9: Reminder data and selection

**Files:** the schema (`reminder_prefs`, `reminder_log`), a migration, `packages/db/src/reminders.ts`. Test:
`packages/db/test/reminders.test.ts`.

**Interfaces:**
- Produces:
  - `getReminderPrefs(db, userId)` and `setReminderPrefs(db, userId, { dayBefore, hourBefore }, source)`, which
    audits `reminders.update` and clears `disabled_reason`.
  - `disableReminders(db, userId, reason)`.
  - `dueDms(db, pool, nowWall): Promise<{ userId; discordUserId; event; kind: 'day' | 'hour' }[]>` covers the
    windows [24 h, 24 h + 1 min) and [1 h, 1 h + 1 min), plus catch-up up to 30 min late. It applies Moje grupy,
    skips banned users, opted-out users and already-logged entries, and keys by `for_starts_at`.
  - `dueDigest(pool, nowWall)` returns tomorrow's events when it is 18:00–18:30 and no digest is logged for
    them.
  - `markSent(db, entries)`: INSERT IGNORE into `reminder_log`.

- [ ] **Step 1: Write failing tests:**
  - an event 24 h ahead → due once, and after `markSent` not due again;
  - the event moved by +2 h after being sent → due again for the new time (Review Focus 4);
  - 40 min late → not due;
  - 20 min late → due;
  - another group's event → not due for that user;
  - a banned user or prefs off → not due;
  - the digest is due only within 18:00–18:30 and only once.
- [ ] **Step 2–4: Run** → FAIL, implement, then the db suite, typecheck and lint → PASS.
- [ ] **Step 5: Commit** `feat(db): reminder preferences and due-reminder selection`.

### Task 10: Sending reminders; preferences in the UI

**Files:**
- `apps/bot/src/reminders.ts`: a 1-minute tick that sends DMs and the digest in `#wydarzenia`. A closed DM leads
  to `disableReminders(..., 'DM zamknięte')` plus a one-time notice on the next panel use.
- `#panel` → Moje grupy gets a "Przypomnienia" row (`stu:rem:day` / `stu:rem:hour` toggles).
- On the web, Moje grupy gets the "Przypomnienia" checkboxes, with a Server Action that calls `requireUser`.
- Tests: `apps/bot/test/reminders.test.ts`, the bot views, web unit tests and `my-groups.spec.ts`.

- [ ] **Step 1: Write failing tests:**
  - the tick sends one DM per due entry and logs it;
  - a restart (new tick instance) sends nothing twice;
  - a DM error 50007 turns prefs off with a reason, and the notice is shown once;
  - the digest posts once with "Jutro:" and no mentions;
  - the toggles persist on both web and Discord.
- [ ] **Step 2–4: Run** → FAIL, implement, then the bot and web suites, typecheck, lint and e2e → PASS.
- [ ] **Step 5: Commit** `feat: event reminders by DM and daily digest`.

## Phase 4 — Uploading files from the website

### Task 11: Upload route and `web_uploads`

**Files:** the schema (`web_uploads`), a migration; `apps/web/app/api/wydarzenia/[id]/pliki/route.ts`; the
event page gets "Dodaj pliki" plus a status list refreshing every 3 s while any upload is queued or posting.
Tests: `apps/web/test/event-upload.test.ts`, `events.spec.ts`.

**Interfaces:**
- Produces: `web_uploads` rows plus one `event_upload` request (target `event:<id>`, payload `{ uploadIds }`).
- The temp name is `uploads/<uuid>`, contained with `resolveInStorage`. The original name is kept for display
  only, trimmed to 200 characters.

- [ ] **Step 1: Write failing tests:**
  - `requireUser`; a banned user gets 403 with nothing stored (Review Focus 3);
  - 11 files → 400;
  - a file of 10 MB + 1 byte → 400;
  - the 31st file within an hour → 429;
  - a filename like `../../x.pdf` is stored under `uploads/<uuid>` with `original_filename` `x.pdf`; `ąę ł.pdf`
    is kept; 300 characters are trimmed (Review Focus 5);
  - a deleted event → 404;
  - **e2e:** an upload shows "wysyłanie…" (no bot in e2e).
- [ ] **Step 2–4: Run** → FAIL, implement, then the web suite, typecheck, lint and e2e → PASS.
- [ ] **Step 5: Commit** `feat(web): upload event files from the website`.

### Task 12: The bot posts web uploads; cleanup; docs

**Files:** `apps/bot/src/events/uploads.ts` (handles `event_upload`: makes sure the post exists, sends the files
as "Plik od <nazwa> (przez stronę)", marks the rows done, deletes the temp files; it also runs a cleanup of
anything older than 24 h on the tick). Update `CLAUDE.md` (events, the queue, reminders, uploads),
`apps/bot/README.md`, and `docs/deploy.md` (new migrations, re-register, `/setup` creates `#wydarzenia`).
Tests: `apps/bot/test/event-uploads.test.ts`.

- [ ] **Step 1: Write failing tests:**
  - a queued upload gets posted with the display name, the rows are `done` and the temp file is removed;
  - missing post → created first;
  - a Discord error → the rows are `failed` with an error and the temp file is kept for retry until 24 h;
  - cleanup removes files and rows older than 24 h only.
- [ ] **Step 2–4: Run** → FAIL, implement, then the full verification: the db, bot, web and worker suites one at a
  time (8 known worker failures), typecheck all, lint, and the full web e2e → PASS.
- [ ] **Step 5: Commit** `feat(bot): post files uploaded on the website; docs`.

## After the plan (controller)

- Final whole-branch review: a general reviewer, `discord-bot-reviewer` and `sql-console-security-reviewer`, on
  the most capable model, followed by one fix wave.
- Merge to `main`. Then `pnpm db:migrate`, `pnpm --filter @studies/bot register`, restart the bot, and ask the
  user to run `/setup` and test. Ask before pushing.

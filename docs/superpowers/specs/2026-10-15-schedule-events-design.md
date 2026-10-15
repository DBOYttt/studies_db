# Schedule events: kolokwia, egzaminy, wyjazdy and extra lessons added by students

Date: 2026-10-15. Status: design approved in chat (parts 1–4). This file is waiting for the user's review.

## Intent

The user asked for a feature that lets students add events to the schedule that the regular UniTime timetable
doesn't have: kolokwia, egzaminy, wyjazdy and special lessons. Clicking an event shows every material associated
with it. Later the user also asked to include reminders, recurring events and uploading files from the website.

Agreed in chat:

- Students add events in Discord (a `#panel` button with a pop-up form, plus `/event add`) and on the website (a
  "+ Wydarzenie" button in Plan zajęć). Both write the same data.
- Materials:
  - each event gets its own forum post, and files uploaded there belong to the event;
  - existing posts can also be linked to an event.
- Permissions are wiki-style:
  - any logged-in student who isn't banned can add, edit or delete any event;
  - every change goes to the audit log (Dziennik);
  - deletes are soft, so an admin can restore an event.
- Subject is optional. An event without a subject gets its post in a new shared forum, `#wydarzenia`, which
  `/setup` creates.
- Data approach: a separate `events` table plus a link table to topics. The UniTime sync never touches events.
- Additions:
  - reminders: an opt-in DM plus a daily digest in `#wydarzenia`;
  - recurring events (weekly or every two weeks, until a date);
  - uploading files from the website. The bot posts them into the event's forum post, so Discord stays the only
    source of files.

The plan delivers this in **4 phases**. Each phase is usable and tested on its own:

1. Events, materials and the plan.
2. Recurring events.
3. Reminders.
4. Uploading files from the website.

Success:

- A student adds "Kolokwium 1 · BD · 20.10 10:00–11:30" from Discord or the web.
- Everyone with matching groups sees it in the web plan and in the Discord plan image.
- Opening it shows its details and every file from its own post and from the linked posts.
- Opted-in students get a DM the day before and an hour before.
- A weekly extra lesson appears every week until its end date.
- A file uploaded on the event page appears in the event's Discord post and in its materials.

## 1. Data (`packages/db`)

- **`events`** (one row per occurrence):
  - `id`;
  - `kind`: enum(`kolokwium`, `egzamin`, `wyjazd`, `zajecia_dodatkowe`, `inne`);
  - `title`: varchar(100);
  - `subject_id`: NULL → subjects. `class_id` and `group_id` are NULL unless there is a subject, and must belong
    to that subject;
  - `starts_at` (wall-clock Warsaw time, same convention as `class_sessions`), `ends_at` NULL, `all_day`
    boolean. When `all_day` is true, `starts_at` is 00:00 and `ends_at` is NULL;
  - `place`: varchar(100) NULL; `note`: varchar(1000) NULL;
  - `series_id`: NULL → event_series;
  - `topic_id`: NULL → topics. This is the event's own forum post, set by the bot. For a series it is the
    series' post;
  - `created_by`, `updated_by` → users; `created_at`, `updated_at`, `deleted_at`;
  - an index on (`starts_at`) and (`subject_id`, `starts_at`).
- **`event_series`:** `id`, `rule` (enum `weekly`, `biweekly`), `until` date, `topic_id` NULL, `created_by`,
  `created_at`, `deleted_at`. The occurrences are stored `events` rows (at most 30, within 1 year).
- **`event_topics`:** (`event_id` or `series_id`) + `topic_id` for linked existing posts. PK on the pair, and a
  CHECK that exactly one owner is set. At most 20 links per owner.
- **`reminder_prefs`:** `user_id` PK, `day_before` boolean, `hour_before` boolean, `disabled_reason`
  varchar(100) NULL (for example "DM zamknięte").
- **`reminder_log`:** (`event_id`, `user_id` NULL for the channel digest, `kind` enum(`day`, `hour`, `digest`),
  `for_starts_at`) UNIQUE, plus `sent_at`. `for_starts_at` keys the reminder to the event's time, so moving an
  event re-arms its reminders.
- **`web_uploads`:** `id`, `event_id`, `user_id`, `storage_path` (a temp path under `STORAGE_DIR/uploads/`,
  contained with `resolveInStorage`), `original_filename`, `size_bytes`, `status` enum(`queued`, `posting`,
  `done`, `failed`), `error` NULL, `created_at`, `finished_at`.
- **`bot_requests`:** the generic DB queue from admin round 2 §2, introduced here. Its kinds are
  `event_post_upsert`, `event_post_archive`, `event_upload` and, in round 2, `setup`, `setup_dry_run` and
  `resync`. It has a single active-request guard per (kind, target), and stale `running` requests are failed on
  bot start.
- **Views and grants:**
  - `v_events` (events not deleted, joined to subject code and name) goes into `PUBLIC_VIEWS`;
  - `events`, `event_series` and `event_topics` go into `CONTENT_TABLES`, so the admin SQL write console can fix
    data;
  - `reminder_prefs`, `reminder_log`, `web_uploads` and `bot_requests` are in neither.
- **Shared logic** in `packages/db/src/events.ts`:
  - `parseWhen(text, now)` turns `DD.MM[.RRRR] [HH:MM[-HH:MM]]` into { startsAt, endsAt, allDay }. With no year
    it picks the nearest future date. It rejects an end that isn't after the start, and dates outside the range
    now − 1 month … now + 1 year;
  - `validateEvent(input)` returns the Polish messages;
  - `addEvent`, `editEvent(scope: 'one' | 'following')`, `deleteEvent(scope)`, `restoreEvent` (admin),
    `linkTopic` / `unlinkTopic`;
  - `listEventsInRange(pool, from, to)`, which returns the same `PlanSession`-like shape with `type: 'event'`;
  - `eventMaterials(db, eventId)` returns the files of the own post plus the linked posts, newest first, without
    deleted ones;
  - every function returns `ActionResult` and writes `admin_audit` (§6).
- **Moje grupy:** an event with a group is filtered like a class session. An event without a group shows for
  everyone with that subject, or for everyone when there is no subject. Hidden events count towards "Ukryte
  zajęcia".
- **Rate limits:** 10 new events and 30 uploaded files per user per hour, counted from `admin_audit`.

## 2. Discord bot

- **`#panel`** gets a 5th button, **"Dodaj wydarzenie"**, which opens a modal with five fields:
  - **Rodzaj** (select);
  - **Tytuł**;
  - **Przedmiot** (select with "— brak —"; the 25-option limit is handled by sorting by semester and code and
    putting "— brak —" first; with more than 24 subjects the modal offers a text field instead, matching on the
    code);
  - **Kiedy** (text, parsed with `parseWhen`);
  - **Miejsce / notatka** (text; the first line is the place, the rest is the note).
- **`/event add`** has all fields as options: `kind`, `title`, `subject` (autocomplete), `when`, `place`, `note`,
  `class`, `group`, `repeat` (`co tydzień` / `co 2 tygodnie`) and `until`. Recurring events can be created only
  here or on the web.
- **The event card** (private V2 view) shows the type symbol (📝 Kolokwium, 🎓 Egzamin, 🚌 Wyjazd,
  ➕ Zajęcia dodatkowe, 📌 Inne), title, subject, when, place, note, who added it and who last edited it.
  - **Materiały (N)** lists file names, each with a link to its web preview. Up to 15 are listed, then "…i N
    więcej — otwórz na stronie".
  - Buttons:
    - **Zajęcia/grupa** (select);
    - **Powiąż posty** (select of the subject's topics, paged; the selected ones toggle);
    - **Edytuj** (modal);
    - **Usuń** (confirm; for a series, "Tylko to" or "To i następne");
    - **Otwórz post** (link);
    - **Otwórz na stronie** (link).
- **The plan views** (day and week) get a **"Wydarzenia"** select listing the period's events, which opens the
  card. The plan image draws events as outlined blocks in a type colour with the type symbol, and all-day events
  in a strip above the hours.
- **Event posts.** The bot processes `event_post_upsert` / `event_post_archive` from `bot_requests`, polling
  every 5 s.
  - It creates or edits the post in the subject's forum or in `#wydarzenia`. The title is
    "<symbol> <Tytuł> — DD.MM", or "🔁 <Tytuł> — co tydzień" for a series.
  - The post is tagged with the forum tag for the event type. `/setup` adds the five type tags to every subject
    forum and to `#wydarzenia`.
  - The first message holds the details and a web link, and the bot edits it on every change.
  - **Archive:** the first message is edited to "Wydarzenie usunięte" and the thread is archived and locked. The
    files stay.
  - **Changing the subject:** the bot creates a post in the new forum. The old post becomes a linked post, so no
    files are lost.
  - **A deleted post:** if the event's post is gone (Unknown Channel), the next upsert creates a new one.
- **Ingestion:** files posted in an event's thread are ordinary topic materials (the existing code). A file posted
  in `#wydarzenia` gets the topic with no subject, so `topics.subject_id` becomes nullable (migration). Every
  subject-based query keeps working by ignoring NULL subjects.
- **`/setup`:** creates the `#wydarzenia` forum (everyone can read and post, like the subject forums) with the
  type tags and a pinned info post explaining it.

## 3. Website

- **Plan zajęć** (simple `/s/plan` and advanced `/plan`):
  - events appear in the week grid as outlined blocks with a type badge, and all-day events in a strip above
    the hours. The day list shows them too;
  - **"+ Wydarzenie"** opens `/s/wydarzenia/nowe` (advanced: `/wydarzenia/nowe`): a full form with every
    field, including class, group, end time, repetition and linked posts (search by title within the subject);
  - clicking an event opens `/s/wydarzenia/[id]` (advanced `/wydarzenia/[id]`).
- **Event page:**
  - details;
  - **Materiały**, with previews like the subject page;
  - linked posts;
  - **Dodaj pliki** (§5);
  - **Edytuj** and **Usuń** (with the series-scope question);
  - **Historia**, the event's `admin_audit` rows;
  - while the bot hasn't created the post yet, "Post na Discordzie: w przygotowaniu".
- **The start page** (`/s`) shows "Nadchodzące wydarzenia": the next 5 events matching Moje grupy.
- **Moje grupy → Przypomnienia:** two checkboxes (24 h before, 1 h before). They are stored in `reminder_prefs`
  and shared with the Discord panel. When DMs failed, `disabled_reason` is shown.
- All mutations are Server Actions that call `requireUser()` themselves, refuse banned users, validate through
  `events.ts`, and run `revalidatePath`.
- **`/admin/audit` (Dziennik)** gets a filter "Wszyscy / Admini", because students now write audit rows too.
- **Admin panel:** a deleted event shows **Przywróć** to admins on its page.

## 4. Reminders

- **The bot sends everything** (`apps/bot/src/reminders.ts`), with a 1-minute tick:
  - **Digest:** at 18:00 Warsaw time, if tomorrow has events, it posts one message in `#wydarzenia`: "Jutro:"
    followed by a line per event with the symbol, title, subject code, time and place. There is no
    @everyone. It is logged as `digest` per event.
  - **DMs:** for each user with prefs on and not banned, events matching their Moje grupy that start in
    [24 h, 24 h + 1 min) or [1 h, 1 h + 1 min), not yet in `reminder_log` for that `for_starts_at`. Catch-up
    after downtime: anything missed by no more than 30 min is still sent, older ones are skipped.
  - The DM text is "Przypomnienie: <symbol> <Tytuł> · <przedmiot> · jutro 10:00 · C-12", with a link to the web
    page.
  - **Closed DMs:** both prefs are set off, `disabled_reason` is set to "DM zamknięte", and the next time the
    user opens a panel view they get a one-time notice.
- **`#panel` → Moje grupy** gets a **"Przypomnienia"** toggle row (24 h / 1 h).

## 5. Uploading files from the website

- **"Dodaj pliki"** on the event page takes up to 10 files, each ≤ 10 MB (Discord's limit), of any type the
  bot already ingests.
- **Upload route:** `POST /api/wydarzenia/[id]/pliki`. It calls `requireUser()`, refuses banned users, enforces
  the size and count limits and the rate limit, streams the files to `STORAGE_DIR/uploads/<uuid>`, creates
  `web_uploads` rows and enqueues one `event_upload` request.
- **The bot** posts the files into the event's thread as "Plik od <nazwa> (przez stronę)". If the thread doesn't
  exist yet, it creates it first. Normal ingestion then adds them as materials (sha256 dedup). The bot then
  marks the rows `done` and deletes the temp files.
- **Status:** the page shows each file as wysyłanie… / gotowe / błąd (`error` text). It refreshes every 3 s while
  any upload is queued or posting.
- **Cleanup:** temp files older than 24 h, and their `queued`/`failed` rows, are deleted by the bot's tick.

## 6. Audit

- Actions: `event.add`, `event.edit`, `event.delete`, `event.restore`, `event.link`, `event.unlink`,
  `event.upload`, `reminders.update`.
- `target` is the event id (or `series:<id>`). `details` holds the changed fields and `source: 'web' | 'discord'`.
- The writer is any user, not only admins: `admin_audit.user_id` already allows that.

## Error handling

- Validation messages are Polish and identical in Discord and on the web, because both come from `events.ts`.
- **Bot offline:** web changes still apply. Requests stay `queued` and the event page says the post is being
  prepared. Nothing is lost.
- **Bot request failures** (permissions, deleted forum) mark the request `failed` with a short Polish error shown
  on the event page to everyone, and log the details.
- **Concurrent edits:** the last write wins. Dziennik keeps every version.

## Testing

- **db:**
  - `parseWhen` (no year → nearest future, all-day, ranges, invalid, boundaries);
  - `validateEvent`;
  - series generation (weekly or biweekly until a date, the 30-occurrence cap, edit "one" vs "following");
  - `eventMaterials` (own post plus linked posts, deleted excluded);
  - the Moje grupy filter with events;
  - `v_events` visible to `studies_ro`; `events` writable and `reminder_log` not writable by `studies_rw`;
  - the `bot_requests` guard;
  - reminder selection (windows, catch-up, dedup per `for_starts_at`, banned users excluded);
  - nullable `topics.subject_id` doesn't break subject queries.
- **Bot:**
  - modal and card views within Discord limits;
  - the card actions (one audit row each, banned users refused);
  - event post upsert, archive and subject move through the setup fakes;
  - the plan image draws events and the all-day strip;
  - the "Wydarzenia" select;
  - the reminder tick (digest once, DM once, closed DMs turn prefs off);
  - `event_upload` posting and cleanup.
- **Web:**
  - Server Actions (`requireUser`, validation, banned users refused);
  - the upload route (size, count, rate limit, path containment);
  - e2e: add an event from the plan, see it in the week, open it and see its materials, edit it, delete it with
    series scope, toggle reminder prefs, and upload a file (status "w kolejce" without a bot).
- **Final review:**
  - `discord-bot-reviewer` checks the queue, posts, reminders and timing;
  - `sql-console-security-reviewer` checks student-writable data, the upload route, the new view and grants, and
    the Server Actions.

## Out of scope

- Approval flow.
- Uploads over 10 MB.
- Calendar export (iCal) of events.
- Editing UniTime classes.
- Push or e-mail notifications.

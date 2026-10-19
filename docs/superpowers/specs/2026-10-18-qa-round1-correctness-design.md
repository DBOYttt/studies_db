# QA fixes, round 1: correctness and security

Source: `docs/qa/2026-10-16/SUMMARY.md` (H1, M1, M2, M17, M19, L1, L4, L22), plus one bug found while
designing (form reset). Later rounds: 1b UI translation to English, 2 navigation and missing pages, 3 forms and
feedback, 4 accessibility and mobile, 5 consistency and polish.

## Goals

- Saving events never fails because another save happened at the same time.
- A refused save never loses what the user typed.
- Two people editing one event can't silently overwrite each other.
- Editing an event deleted elsewhere ends in a clear message, not a 404.
- Every refused admin SQL statement is audited and explained; no SQL error reveals DB users, hosts or schema names.

New and changed messages in this round are in English (the UI goes English in round 1b; content stays Polish).
The Discord bot keeps its Polish text.

## 1. Transaction retry (H1)

Cause: event transactions read `bot_requests` (`enqueueBotRequest`) and then insert into it. With MariaDB's snapshot
isolation a concurrent commit makes the statement fail with `ER_CHECKREAD` (errno 1020); deadlocks (1213) and lock
wait timeouts (1205) are possible too. `POST /s/wydarzenia/nowe` returned 500 and nothing was saved.

- New `withTxRetry(db, fn, { attempts = 3 })` in `packages/db/src/tx.ts`: runs `db.transaction(fn)` and retries the
  whole transaction on errno 1020 or 1213 (also when wrapped in a Drizzle error's `cause`), with a random
  20–80 ms pause. Other errors and the last failure are rethrown. Lock wait timeouts (1205) are not retried: each
  attempt already waited the full lock timeout.
- Every transaction in `events.ts` and `event-series.ts` (add, edit, delete, restore, link, unlink, series add,
  edit, delete, link, unlink) uses it. `fn` must stay free of side effects outside the DB (it already is).
- The enqueue stays inside the transaction, so a post update is never lost.

Test (`packages/db/test/tx.test.ts`): unit tests with a fake `db.transaction` for retry and rethrow; an integration
test that runs pairs of concurrent `addEvent` calls on the test DB and expects every call to succeed.

## 2. Forms keep input on refusal (new)

Cause: `EventForm` uses `<form action={submit}>`. React 19 resets uncontrolled fields after a form action finishes,
including after a refusal, so the user sees an empty form ("submitted, nothing happened").

- `EventForm` submits with `onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }}`.
  Success still redirects from the Server Action.
- Every other client form whose action can be refused (grep `action={` in `apps/web/components` and `app/`) gets
  the same change. Forms that always succeed or always navigate may stay as they are.
- e2e test: a refused event save (title too long) keeps the typed title and shows the message.

## 3. Optimistic concurrency for edits (M1)

`updated_at` has second precision, so it can't detect conflicts. A version counter is used instead.

- Migration (Drizzle generate): `version INT NOT NULL DEFAULT 0` on `events` and `event_series`.
- Every write of an event row increments `version` (edit, delete, restore, link, unlink, series edits and
  splits). Series-level writes increment the series' version and the versions of the occurrences they touch.
- `editEvent(…, opts?: { expectedVersion?: number })` and `editInSeries` update with `WHERE id = ? AND version = ?`.
  `affectedRows = 0` with the row still present → refusal `CONFLICT`: "Someone changed this event while you were
  editing. Your changes weren't saved — reload to see the current version." Without `expectedVersion` the check is
  skipped (old Discord buttons, scripts).
- `deleteEvent` accepts `expectedVersion` the same way (the delete button on the event page sends it).
- Web: `loadEventForm` returns `version`; `EventForm` sends it as a hidden `version` field; `updateEventAction`
  passes it on.
- Discord: the existing event edit modal's `custom_id` gains the version as one more argument (still ≤ 100 chars,
  checked by `ids.ts`); the submit handler passes it. A stale panel without a version keeps working without the check.
- `getEvent` / views: `version` is added to `getEvent`'s result only; `v_*` views stay unchanged.

Tests (db): stale version refused with no row change and no audit; current version saves and increments; no
version saves; series edit "one" and "following" with a stale version refused. Bot: modal custom_id round-trip.

## 4. Edit of a deleted event (M2)

- `loadEventForm(id)` returns `{ state: 'deleted', … }` (values from the deleted row) instead of calling `notFound()`
  when the event is soft-deleted; an unknown id still 404s.
- Both edit pages (simple and advanced) render the form with a banner "This event was deleted. Your changes weren't
  saved." and the Save button disabled, plus "Back to plan" (and "Restore" for admins, using the existing restore
  action).
- `updateEventAction` keeps returning the NOT_FOUND refusal; with change 2 the typed values stay on screen.
- e2e: delete in one context, save in another → banner, typed title still present.

## 5. Admin SQL permission refusals (M17, auditor F2)

- In `admin-sql-handler.ts`, a MariaDB error with errno 1142, 1143 or 1044 at preview or execute writes
  `admin_audit` `{ action: 'sql.rejected', statement, details: { mode, reason: 'permission', table?, column? } }`
  (audit failure is logged, as for classifier rejections).
- `adminSqlErrorMessage` distinguishes:
  - 1142 → "Table `<t>` is outside the console's scope."
  - 1143 → "Column `<c>` of `<t>` can't be changed from the console."
  - 1044 → "The console has no access to this database."
  Table and column come from the MariaDB message (`for table '<t>'`, `for column '<c>' in table '<t>'`), without
  the schema prefix; if parsing fails the message omits the name.

Tests: handler tests with fake RW errors for each errno → status 400, message, one audit row.

## 6. Sanitized SQL errors (M19)

- New `sanitizeDbMessage(message)` in `apps/web/lib/sql-messages.ts`: removes `'user'@'host'` (and the
  `to user …` / `for user …` phrase around it) and `schema.` prefixes of the current DB name, e.g.
  `SELECT command denied to user 'studies_ro_qa'@'10.88.0.2' for table \`studies_qa_test\`.\`users\`` →
  "SELECT command denied for table `users`".
- Used by the read console (`sql-console.ts` query errors), the table browser and the admin console's verbatim
  fallback.
- Unit tests with real MariaDB message strings for 1142, 1143, 1044, 1045, and a syntax error (unchanged).

## 7. Smaller fixes

- **L1 series end date:** `addSeries` stores `until` as the date of the last generated occurrence, so the shown end
  date never jumps after an edit. Existing series aren't migrated (the value is already within range).
- **L4 audit count:** investigate why Dziennik showed "30 entries" with ids up to 31 and #25 missing. If it is a
  counting or filtering bug, fix it with a test. If #25 is legitimately hidden, the list says which filter hides
  it. The finding is closed either way, with the cause written in the plan's notes.
- **L22 missing Origin:** `isCrossOrigin(req)` also refuses a request with no `Origin` header unless
  `Sec-Fetch-Site` is `same-origin`. Applies to the upload route and the admin SQL
  route. Browsers send one of the two, so normal use is unaffected. Unit tests for: matching Origin, foreign Origin,
  no Origin + same-origin fetch site, neither header.

## Out of scope

UI text translation (round 1b), and the UI findings of rounds 2–5. The bot's text.

## Done when

- `pnpm test`, the four typechecks, `pnpm lint` and the web e2e pass (worker tests need LibreOffice/poppler; run
  them where installed or note it).
- A short QA re-run of `qa-chaos` and `qa-security-auditor` against the sandbox finds none of H1, M1, M2, M17, M19,
  L22.

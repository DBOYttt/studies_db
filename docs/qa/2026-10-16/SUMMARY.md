# QA run 2026-10-16: summary

All 8 personas tested the sandbox (`:3200`, `studies_qa_test`) in parallel, each in its own browser.

| Persona | Critical | High | Medium | Low | Idea | Report |
|---|---|---|---|---|---|---|
| Student (Ola) | 0 | 0 | 2 | 5 | 2 | [qa-student](qa-student.md) |
| Novice (Pan Zenon) | 0 | 0 | 4 | 1 | 1 | [qa-novice](qa-novice.md) |
| Admin (Adam) | 0 | 0 | 1 | 7 | 2 | [qa-admin](qa-admin.md) |
| Mobile (Marta) | 0 | 0 | 4 | 6 | 1 | [qa-mobile](qa-mobile.md) |
| A11y (Kuba) | 0 | 0 | 4 | 3 | 1 | [qa-a11y](qa-a11y.md) |
| Chaos (Szymon) | 0 | 0 | 2 | 2 | 1 | [qa-chaos](qa-chaos.md) |
| Curator (Ula) | 0 | 0 | 6 | 14 | 12 | [qa-curator](qa-curator.md) |
| Security auditor (Mallory) | 0 | 0 | 1 | 2 | 1 | [qa-security-auditor](qa-security-auditor.md) |
| Controller (server log) | 0 | 1 | 0 | 0 | 0 | below |

The security audit found **no authentication or authorization bypass** and no missing limit. Authentication,
authorization, event validation, output encoding, upload limits, rate limits, the SQL console scopes and the audit
log all passed (see the audit's checklist table).

## Run caveats (sandbox, not app)

- **No browser** at first: Playwright MCP expected chromium-1247. It was installed and the personas re-ran.
- **SQL console DB users:** the sandbox shared `studies_ro_test` / `studies_rw_test` with the test suite, and a
  concurrent `resetTestDb` re-granted them on `studies_test` only. The sandbox now has its own users
  (`studies_ro_qa` / `studies_rw_qa`). The server was restarted once, so some personas briefly saw
  "Nie udało się połączyć z bazą danych" on `/s/plan` and lost their session (novice F1, curator F1/F2,
  chaos F3, mobile F11). This is **not counted as an app bug** below.
- **Hot reloads:** `next dev` hot-reloaded pages during the run, which reset forms, focus and the preview panel
  (admin F10, a11y F7, student F9). Some form findings may be partly caused by this (marked "maybe dev").
- A usage limit paused every agent once; they resumed from where they stopped.

## Findings (deduplicated, by severity)

### High

**H1. Concurrent event creation fails with a 500 (`ER_CHECKREAD`)**
- Found by: the controller, in the server log, while personas created events at the same time. The other personas
  probably hit it as "the form reset and nothing was saved": [novice F4](qa-novice.md), [mobile F2](qa-mobile.md).
- `enqueueBotRequest` (`packages/db/src/bot-requests.ts:58`) runs `INSERT … SELECT … WHERE NOT EXISTS (SELECT … FROM
  bot_requests …)` inside the event transaction. Under MariaDB's snapshot isolation, a concurrent change to
  `bot_requests` makes it fail with "Record has changed since last read in table 'bot_requests'". As a result
  `POST /s/wydarzenia/nowe` returned 500, the transaction rolled back, and the user saw no message.
- Fix direction: retry the transaction on `ER_CHECKREAD`/deadlock, or enqueue outside the transaction or without the
  read (unique key on `(kind, target)` for queued rows + `INSERT IGNORE`).

### Medium

| # | Finding | Personas |
|---|---|---|
| M1 | Two tabs editing the same event: the second save silently overwrites the first (no conflict check) | [chaos F1](qa-chaos.md) |
| M2 | Saving an edit of an event that was deleted elsewhere: bare English 404, typed edits lost | [chaos F2](qa-chaos.md) |
| M3 | Default English 404 with no navigation, e.g. `/s/wydarzenia` and `/wydarzenia` have no index page | [curator F3](qa-curator.md), [admin F6](qa-admin.md), chaos F2 |
| M4 | No list of events anywhere: you can only reach them from the plan | curator U3, [admin F6](qa-admin.md) |
| M5 | Start page doesn't answer "what's next": no today/this-week classes | [student F1](qa-student.md), [novice F2](qa-novice.md), curator U1 |
| M6 | The simple plan's "zmień" / "Ukryte zajęcia" links drop the user into the advanced UI (`/plan?tab=groups`) | [student F2](qa-student.md) |
| M7 | No save confirmation for Moje grupy and reminders, and the 7 dropdowns all say "Wszystkie" | [novice F3](qa-novice.md), [student F5](qa-student.md) (low), student F6 |
| M8 | Event form: required fields not marked; English validation tooltip and file input; create and edit forms differ (no "Zajęcia" on create) | [a11y F3](qa-a11y.md), [curator F12](qa-curator.md), [novice F4](qa-novice.md), [mobile F7](qa-mobile.md), [student F8](qa-student.md), curator F11 |
| M9 | Simple and advanced search return different results and scope (4 files vs 5 hits); simple search has no snippet | [curator F5](qa-curator.md), [student F7](qa-student.md) |
| M10 | Subject page shows "Projekt" in both the Zajęcia and Rodzaj filter rows | [curator F9](qa-curator.md) |
| M11 | Simple plan has no "Lista" view, so a phone shows about 2 days of the grid | [curator F6](qa-curator.md) |
| M12 | Inline PDF preview on mobile stays on "Wczytywanie podglądu…" (full-screen route works; maybe dev) | [mobile F1](qa-mobile.md) |
| M13 | Tap targets under 44 px (hamburger, Podgląd/Pobierz, Edytuj/Usuń, chips, 13 px checkboxes); mode toggle tiny and icon-only | [mobile F3, F4](qa-mobile.md), [curator F14](qa-curator.md), chaos F4 |
| M14 | No skip link (main content is the 16th Tab stop) | [a11y F1](qa-a11y.md) |
| M15 | File preview panel doesn't take focus, isn't announced, no Escape | [a11y F2](qa-a11y.md) |
| M16 | Plan grid: event blocks not tied to their day for screen readers | [a11y F4](qa-a11y.md) |
| M17 | Admin SQL write console: refusals that come from MariaDB grants (e.g. `UPDATE users`) are not written to `admin_audit`, and the message says "tabela poza zakresem" even for content tables | [admin F1](qa-admin.md), [security F2](qa-security-auditor.md) (low), admin F2 |
| M18 | Audit log (Dziennik): the "Tabela" column holds event ids / `series:N`, "Admin" lists students, "Instrukcja" is empty for event rows | [curator F18](qa-curator.md), [admin F4](qa-admin.md) |
| M19 | Read SQL console errors leak the DB user, internal IP and schema name (`denied to user 'studies_ro_qa'@'10.88.0.2' … studies_qa_test.users`) | [security F1](qa-security-auditor.md) |

### Low

| # | Finding | Personas |
|---|---|---|
| L1 | Series end date changes (14.11 → 10.11) after editing/deleting an occurrence | [admin F3](qa-admin.md) |
| L2 | Upload status list in reverse order; no hint that it waits for the bot | [admin F5](qa-admin.md) |
| L3 | "To i następne" delete doesn't say how many events it removes | [admin F7](qa-admin.md) |
| L4 | Audit count says 30 while ids go to 31 with #25 missing (unexplained) | [admin F8](qa-admin.md) |
| L5 | Breadcrumb's current page truncated ("Kons…") on mobile; "Start" crumb is plain text | [mobile F5](qa-mobile.md), [curator F13](qa-curator.md), admin F8, [a11y F6](qa-a11y.md) |
| L6 | Week navigation row overflows its column on mobile | [mobile F6](qa-mobile.md) |
| L7 | Delete confirmation shifts the layout | [mobile F8](qa-mobile.md) |
| L8 | Full-screen PDF has no way back into the app | [mobile F9](qa-mobile.md) |
| L9 | Advanced `/sql` on mobile: results not visible after "Wykonaj" (fixed "Konsola" bar covers them); tab strip scrolls sideways | [mobile F10](qa-mobile.md), [curator F15](qa-curator.md) |
| L10 | No live regions ("Zapisano", upload status not announced) | [a11y F5](qa-a11y.md) |
| L11 | Subject page "Najbliższe zajęcia" ignores Moje grupy | [student F4](qa-student.md) |
| L12 | Hidden-classes note wording unclear | [student F3](qa-student.md) |
| L13 | Event page jargon ("Post na Discordzie: w przygotowaniu"); "Rodzaj" filter label unclear | [novice F5, F6](qa-novice.md) |
| L14 | Naming differs between modes and inside advanced mode | [curator F7](qa-curator.md) |
| L15 | Advanced rail: duplicate logout, icon-only entries | [curator F8](qa-curator.md) |
| L16 | Search highlight padding splits words | [curator F10](qa-curator.md) |
| L17 | Missing favicon (404) | [curator F4](qa-curator.md) |
| L18 | "Struktura": columns with no information, mixed alignment | [curator F16](qa-curator.md) |
| L19 | Schema designer connector lines run under the tables | [curator F17](qa-curator.md) |
| L20 | "Konsultacje" plan block shows a "+" glyph | [curator F19](qa-curator.md) |
| L21 | Admin SQL: disabled buttons too faint; two histories | [curator F20](qa-curator.md) |
| L22 | Upload route accepts requests with no `Origin` header (a foreign Origin is refused) | [security F3](qa-security-auditor.md) |
| L23 | Top-bar "\|" separator is 3.9:1 in dark mode | [a11y F8](qa-a11y.md) |

## Curator's top 5

1. **Mobile plan:** a "Lista" view as the default under 640 px in simple mode, with timetable blocks linking to the
   subject (M11, U2).
2. **Rework the simple Start:** next classes and events first, then recent files, then subjects (M5, U1).
3. **An events list and a Polish 404** (M3, M4).
4. **Cut steps in the event form:** defaults from the screen it was opened from, required markers, a single upload
   step on the event page (M8, U4, U5).
5. **Align simple and advanced vocabulary and results:** the same search scope, the same nouns, clearer audit
   headers (M9, L14, M10, M18).

Ideas raised by two or more personas:
- Show "next class / today" on Start (student, novice, curator).
- An events list (curator, admin).
- Save confirmations / live regions (novice, student, a11y).
- Return 401 instead of a redirect for anonymous API calls (security only; listed for completeness).

## Not tested or blocked

- **Upload retry:** an upload never reaches `failed` without the bot running (admin).
- **Refresh mid-upload / upload to a deleted event:** the chaos browser couldn't set files from disk.
- **The 20-link cap:** the sandbox has only 17 topics (security).
- **Cookie flags** (security).
- **Pinch zoom, all-day events on mobile** (mobile).
- **A11y gaps:** Moje grupy interaction, the event page, advanced modals, dark-mode contrast on the plan and form.
- **Rapid mode switching** (chaos).
- **Executing a large (126-row) admin update** (admin; the confirmation gate was verified).
- **Discord side:** out of scope for the sandbox.

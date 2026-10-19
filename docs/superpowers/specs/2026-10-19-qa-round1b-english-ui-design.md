# QA fixes, round 1b: English interface

Decision (user, 2026-10-18/19): the whole interface — website and Discord bot — is English. Only content stays
Polish. This round comes before the UI rounds (2–5) so they write English from the start.

## Goals

- Every string a user reads on the website or in Discord is English, with one consistent vocabulary.
- Content is untouched and still reads naturally in Polish.
- Nothing that already links into the app (Discord posts, bookmarks) breaks.

## 1. Scope

Translated (everything a user reads):
- Website: labels, headings, buttons, empty/loading/error states, tooltips, `aria-label`s and other accessible names,
  page titles/metadata, placeholders, confirmation texts, CSV headers that the UI produces, the login-info page.
- Shared messages in `packages/db` that users see: refusals and results of events, series, admin actions, uploads,
  plan/date parsing, search, reminders, event posts.
- Discord bot: panel views, buttons, select placeholders, modals (titles, labels, placeholders), replies, stale-panel
  replies, `/setup` progress/results, reminder DMs, the daily digest, event forum posts, upload messages
  ("File from <name> (via the website)"), slash command and option descriptions (re-registered).

Unchanged:
- Content: subject, file, lecturer, room names, descriptions, topic titles, seed data.
- Class-type tags and their parsing: Wykład, Laboratorium, Ćwiczenia, Projekt, Seminarium, `Gr. N` (and the accepted
  variants `Gr3`, `Grupa 3`, `G3`).
- Stored keys and codes (`kolokwium`, `egzamin`, … in the DB; cookie names; `custom_id`s).
- URLs and routes (`/s/wydarzenia/12`, `/plan`, …): Discord posts already link to them.
- Discord channel names created by `/setup` (`#panel`, `#wydarzenia`, `#admin-panel`): renaming live channels is out
  of scope. The bot's text refers to them by mention, so their names don't appear in its copy.
- Server log messages (`console.*`), test fixture content, comments.
- Input syntax: the "When" field still takes `DD.MM[.YYYY] [HH:MM[-HH:MM]]` (hints say `DD.MM.YYYY`).

## 2. Glossary

`docs/glossary.md` is the single source for terms; every task follows it and adds any new term it introduces.
Core terms:

| Polish | English |
|---|---|
| Plan zajęć | Timetable |
| Moje grupy | My groups |
| Wydarzenia / Wydarzenie | Events / Event |
| Kolokwium | Test |
| Egzamin | Exam |
| Wyjazd | Trip |
| Zajęcia dodatkowe | Extra class |
| Inne | Other |
| Materiały | Materials |
| Ostatnio dodane | Recently added |
| Raporty | Reports |
| Szukaj / Wyszukiwanie | Search |
| Przedmioty | Subjects |
| Prowadzący | Lecturers |
| Zajęcia (class of a subject) | Class |
| Grupa | Group |
| Dziennik | Audit log |
| Przegląd | Overview |
| Prosty / Zaawansowany (mode) | Simple / Advanced |
| Kiedy / Miejsce / Notatka | When / Place / Note |
| Przywróć | Restore |
| Konsola SQL / SQL — zapis | SQL console / SQL — write |
| Przypomnienia | Reminders |
| Podgląd / Pobierz | Preview / Download |

The class-type tags above are content and are never translated, also not inside English sentences
("Laboratorium, Gr. 2").

## 3. Dates and locale

- Display formatting uses `en-GB` with 24-hour times, Warsaw wall clock as today: e.g. "Tue 20 Oct 2026, 10:00",
  "20 Oct", week labels "Week 43 · 19–25 Oct 2026".
- Collation stays `'pl'` (`localeCompare(…, 'pl')`, `toLocaleLowerCase('pl')`): the sorted values are Polish names.
- `<html lang="en">`.
- Plural forms become English (1 file / 2 files); the Polish plural helpers are replaced, not kept.

## 4. Tests and docs

- Every test that asserts UI text (vitest and Playwright) is updated in the task that translates that text.
- `CLAUDE.md`: "UI strings, log messages and domain terms are Polish" becomes "UI strings are English (see
  docs/glossary.md); content and class-type tags stay Polish; log messages may be Polish".
- `scripts/check-ui-language.mjs` (root, run by `pnpm check:lang`): lists lines with Polish diacritics in
  `apps/web/{app,components,lib}`, `apps/bot/src` and user-facing `packages/db/src` modules, excluding comments and
  an allowlist (class-type tag constants, the group-tag regex, seed and QA CLI data, `console.*` lines, collation
  calls). It must report nothing at the end of the round. Words without diacritics are covered by review and the QA
  run, not by the script.
- After the round, `qa-curator` (and `qa-novice`) re-run in the sandbox and check the copy.

## 5. Order of work

1. Glossary + shared `packages/db` messages (and their tests).
2. Website simple mode.
3. Website advanced mode.
4. Website admin pages.
5. Bot panels, modals, commands (+ re-register note).
6. Bot event posts, reminders, digest, uploads.
7. Dates/locale, `lang`, plurals, CLAUDE.md.
8. `check:lang` script, full verification, QA re-run.

## Out of scope

Renaming channels or URLs; new features; the UI findings of rounds 2–5 (they will be written in English).

## Done when

`pnpm test`, the four typechecks, `pnpm lint`, the web e2e and `pnpm check:lang` pass; the QA copy review finds no
leftover Polish UI text outside the allowed content.

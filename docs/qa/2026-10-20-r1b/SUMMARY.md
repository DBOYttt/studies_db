# QA run 2026-10-20-r1b — English interface (round 1b)

Sandbox: http://localhost:3200, DB `studies_qa_test`, branch `feat/english-ui` at 363a915.

## Personas

| Persona | Result | Report |
|---|---|---|
| qa-curator | stopped early (weekly usage limit, HTTP 429) before writing a report | — |
| qa-novice | stopped early (weekly usage limit, HTTP 429) before writing a report | — |

Screenshots taken before the stop are in `.qa/screens/2026-10-20-r1b/`.

## Substitute check: automated copy crawl

Because both personas stopped, the controller crawled the sandbox signed in as `curator` (admin): 41 pages, both
modes (simple `/s/...` and advanced), admin pages, event forms, search, SQL console, table browser. Each page's
visible text and `aria-label`/`title`/`placeholder`/`alt` values were checked for Polish diacritics and common Polish
UI words.

Every hit except those below is allowed content: subject, file, topic, lecturer and room names, descriptions, seed
office hours (`śr. 10:00-11:30`), and the class-type tags (Wykład, Ćwiczenia, Laboratorium, Projekt, `Gr. N`).

## Findings

| # | Severity | Where | Text | Fix |
|---|---|---|---|---|
| 1 | low | advanced home, subjects grid (`lib/subjects-grid.ts`) | column headers `zajecia`, `pliki`, `ostatnio` (SQL aliases shown as headers) | alias as `classes`, `files`, `latest` |
| 2 | low | file lists, dates everywhere using `Intl` en-GB short month | "29 Sept 2026" while the spec and week labels use "Sep" | normalise the short month to "Sep" |

No leftover Polish interface text was found otherwise.

## Not tested

- Copy quality and clarity as judged by a person (the curator and novice reviews). Re-run both personas after the
  usage limit resets (Oct 22, 21:00 Warsaw).
- Client-only states the crawl can't reach (error toasts, confirmations after submit, upload failures, mobile/dark
  layouts). These are covered by vitest and e2e text assertions.
- Discord (bot) copy: no sandbox; covered by bot unit tests and reviews.

# Studies DB — Design Spec

**Date:** 2026-10-10
**Owner:** andrzejcn041@gmail.com
**Status:** Draft — awaiting review

## 1. Purpose

A shared knowledge base for the 1st year of **Technologie Przemysłu 4.0, AGH Kraków**.
Students upload notes, lecture slides, lab reports and exam materials to Discord;
a bot records them in a relational database; a website lets students browse,
preview, search and query everything — phpMyAdmin-style, but friendly.

**Success criteria**

- A student posts a file in the right Discord forum thread and, without doing
  anything else, it appears on the website under the correct subject and topic.
- Office documents and PDFs can be read in the browser without downloading.
- Any student can find a material by full-text search over its contents.
- Curious students can run their own read-only SQL queries against the data,
  with no way to modify or break the database.
- No separate account/password: access is granted via Discord.

**Non-goals (v1)**

- No upload through the website (Discord is the only entry point).
- No OCR of images/scanned PDFs.
- No file-type or size restrictions beyond Discord's own (curated community).
- No multi-year / multi-faculty support (single year group).
- No public internet access without a Discord-issued link.

## 2. Context & Constraints

- Audience: one year group (~100–200 students), one Discord server.
- Production: single home server, exposed via **Cloudflare Tunnel** (`cloudflared`),
  everything in containers (Compose). No inbound ports.
- Development: locally on the owner's Fedora machine (Node 22, Podman,
  LibreOffice and poppler `pdftotext` available).
- Language: **TypeScript** everywhere.

## 3. Architecture

pnpm-workspace monorepo:

```
studies_db/
├─ packages/db      Drizzle ORM schema, migrations, views, shared types & queries
├─ apps/bot         discord.js — forum sync, file download, slash commands
├─ apps/worker      job runner — LibreOffice → PDF, text extraction
├─ apps/web         Next.js (App Router) — browse, preview, search, tables, SQL console
├─ storage/         (gitignored) originals/ and previews/
└─ compose.yaml     mariadb, bot, worker, web (+ cloudflared in prod profile)
```

Data flow:

```
Discord forum post ──► bot ──► storage/originals/<sha256>.<ext>
                         │
                         └──► MariaDB: materials (pending) + jobs
                                         │
                       worker ◄──────────┘  convert / extract_text
                         │
                         └──► storage/previews/<sha256>.pdf, materials.extracted_text, status=ready
                                         │
                       web ◄─────────────┘  reads DB + streams files (session-checked)
```

The bot and worker communicate **only through the `jobs` table** — no Redis/message
broker. The bot, worker and web never call each other directly; MariaDB and the
`storage/` volume are the shared state. Each app can crash/restart independently.

## 4. Database Schema (MariaDB 11)

```
subjects ──< topics ──< materials >── users
   │           │            │
   │           └──< topic_tags >── tags
   │                        └──< jobs
   └──< subject_lecturers >── lecturers
users ──< sessions
users ──< login_tokens
```

### Tables

**subjects**
| column | type | notes |
|---|---|---|
| id | INT PK AI | |
| name | VARCHAR(200) | "Mechanika" |
| code | VARCHAR(20) UNIQUE | "MECH" |
| semester | TINYINT | 1 or 2 |
| ects | TINYINT | |
| description | TEXT NULL | |
| discord_channel_id | VARCHAR(32) UNIQUE | forum channel snowflake |
| created_at | DATETIME | |

**lecturers**
| id | INT PK AI |
|---|---|
| name | VARCHAR(200) |
| title | VARCHAR(50) NULL — "dr inż." |
| email | VARCHAR(200) NULL |

**subject_lecturers** — PK (subject_id, lecturer_id, role)
| subject_id | FK subjects ON DELETE CASCADE |
|---|---|
| lecturer_id | FK lecturers ON DELETE CASCADE |
| role | ENUM('wyklad','laboratorium','cwiczenia','projekt') |

**topics**
| column | type | notes |
|---|---|---|
| id | INT PK AI | |
| subject_id | FK subjects | |
| title | VARCHAR(300) | = forum thread name, kept in sync |
| discord_thread_id | VARCHAR(32) UNIQUE | |
| created_by | FK users NULL | thread owner |
| created_at | DATETIME | |
| deleted_at | DATETIME NULL | soft delete |

**tags** — mirrors Discord forum tags
| id | INT PK AI |
|---|---|
| subject_id | FK subjects |
| name | VARCHAR(50) — "Wykład", "Laboratorium", "Ćwiczenia", "Kolokwium", "Egzamin" |
| discord_tag_id | VARCHAR(32) UNIQUE |

**topic_tags** — PK (topic_id, tag_id), both FKs ON DELETE CASCADE.

**users**
| column | type | notes |
|---|---|---|
| id | INT PK AI | |
| discord_user_id | VARCHAR(32) UNIQUE | |
| display_name | VARCHAR(100) | refreshed on each sighting |
| avatar_url | VARCHAR(500) NULL | |
| is_banned | BOOL DEFAULT false | |
| created_at | DATETIME | |

**materials**
| column | type | notes |
|---|---|---|
| id | INT PK AI | |
| topic_id | FK topics | |
| uploader_id | FK users | |
| discord_message_id | VARCHAR(32) | indexed |
| discord_attachment_id | VARCHAR(32) UNIQUE | idempotency key |
| original_filename | VARCHAR(500) | |
| mime_type | VARCHAR(150) | |
| size_bytes | BIGINT | |
| sha256 | CHAR(64) | indexed; file stored by hash (dedup on disk) |
| storage_path | VARCHAR(500) | relative to storage root |
| preview_path | VARCHAR(500) NULL | PDF preview, relative |
| preview_kind | ENUM('pdf','image','text','none') | |
| extracted_text | MEDIUMTEXT NULL | capped at ~1 MB |
| status | ENUM('pending','ready','failed') | |
| created_at | DATETIME | Discord message timestamp |
| deleted_at | DATETIME NULL | soft delete |

FULLTEXT index: `(original_filename, extracted_text)`; topics get FULLTEXT on `title`.

**jobs**
| column | type | notes |
|---|---|---|
| id | INT PK AI | |
| material_id | FK materials ON DELETE CASCADE | |
| type | ENUM('convert','extract_text') | |
| status | ENUM('queued','running','done','failed') | |
| attempts | TINYINT DEFAULT 0 | |
| last_error | TEXT NULL | |
| run_after | DATETIME | backoff scheduling |
| locked_at | DATETIME NULL | stale-lock recovery |

**login_tokens** — one-time `/link` tokens
| id | INT PK AI |
|---|---|
| user_id | FK users |
| token_hash | CHAR(64) UNIQUE (sha256 of token) |
| expires_at | DATETIME (now + 15 min) |
| used_at | DATETIME NULL |

**sessions**
| id | INT PK AI |
|---|---|
| user_id | FK users |
| token_hash | CHAR(64) UNIQUE |
| expires_at | DATETIME (now + 30 days) |
| created_at | DATETIME |

**bot_state** — sync watermarks
| subject_id | FK subjects, PK |
|---|---|
| last_synced_at | DATETIME NULL |

### Public views (for Tables browser and SQL console)

Exposed to the read-only DB user `studies_ro`:

- `v_subjects` — all subject columns
- `v_lecturers`, `v_subject_lecturers`
- `v_topics` — excluding soft-deleted
- `v_tags`, `v_topic_tags`
- `v_materials` — id, topic_id, uploader_id, original_filename, mime_type, size_bytes,
  preview_kind, status, created_at (no paths, no extracted_text, excluding soft-deleted)
- `v_users` — id, display_name, created_at (no Discord IDs, no ban flag)

`sessions`, `login_tokens`, `jobs` and raw tables are **not** granted to `studies_ro`.

## 5. Discord Bot (`apps/bot`)

**Configuration (env):** `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `ADMIN_ROLE_ID`,
`WEB_BASE_URL`, `DATABASE_URL`, `STORAGE_DIR`.

**Admin slash commands** (require `ADMIN_ROLE_ID`):
- `/subject add channel name code semester ects [description]` — link a forum channel
- `/subject edit …`, `/subject list`
- `/lecturer add name [title] [email]`
- `/lecturer assign subject lecturer role`
- `/ban user` / `/unban user` — website access (and invalidates sessions)
- `/resync` — rescan all linked forums

**Student slash commands:**
- `/link` — DM a one-time login URL `WEB_BASE_URL/auth/callback?token=…` (15 min)
- `/search query` — top 5 matches (title, subject, link to website)

**Event handling** (only for forums linked in `subjects`):

| Event | Action |
|---|---|
| threadCreate | upsert topic; sync tags; upsert creator user |
| threadUpdate | update title, sync tags |
| threadDelete | soft-delete topic + its materials |
| messageCreate with attachments | per attachment → ingest (below) |
| messageUpdate (attachments removed) | soft-delete removed attachments |
| messageDelete | soft-delete that message's materials |
| channelUpdate (forum tags changed) | sync `tags` |

**Ingest of one attachment:**
1. Skip if `discord_attachment_id` already exists (idempotent).
2. Stream download to a temp file while computing sha256.
3. Move to `storage/originals/<sha256>.<ext>` (skip move if already present — dedup).
4. In one transaction: upsert user, insert `materials` (status `pending`, `preview_kind`
   decided from extension/mime), insert `jobs` (`convert` if office/pdf-able,
   `extract_text` if text-extractable; if neither → status `ready` immediately).
5. React ✅ (♻️ if sha256 was already stored). On failure react ❌ and log.

**Startup catch-up:** on `ready`, for each linked forum fetch active + archived threads
and their messages, ingest anything missing. Bounded by a `last_synced_at`
watermark per subject (stored in a small `bot_state` table) to avoid rescanning
everything every restart; `/resync` ignores the watermark.

**No file-type or size limits** beyond Discord's own.

## 6. Worker (`apps/worker`)

- Poll `jobs` every 3 s; claim with `UPDATE … SET status='running', locked_at=NOW()
  WHERE id = (SELECT … WHERE status='queued' AND run_after<=NOW() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)`.
- Jobs with `status='running'` and `locked_at` older than 10 min are re-queued (crash recovery).
- Concurrency: 2 jobs at a time (configurable).

| Input | convert | extract_text |
|---|---|---|
| pdf | — (`preview_kind=pdf`, original is the preview) | `pdftotext` |
| doc/docx/odt/rtf, ppt/pptx/odp, xls/xlsx/ods | `soffice --headless --convert-to pdf` → `previews/<sha>.pdf` | `pdftotext` on the preview |
| txt, md, csv, source code | — (`preview_kind=text`) | read file (UTF-8, lossy) |
| png, jpg, gif, webp | — (`preview_kind=image`) | — |
| other | — (`preview_kind=none`) | — |

- Timeouts: 120 s per conversion, 30 s per extraction. Extracted text truncated to 1 MB.
- `extract_text` for office files runs after `convert` (enqueued by convert on success).
- Failures: retry up to 3× with backoff 1 min / 5 min / 30 min, then job `failed` and
  material `failed`. A failed material is still listed and downloadable; only preview
  and content search are missing.
- When all jobs for a material are `done`, set material `status='ready'`.
- Preview is deduplicated by sha256 (skip conversion if `previews/<sha>.pdf` exists).

## 7. Website (`apps/web`, Next.js App Router)

**Auth**
- `GET /auth/callback?token=…` — hash token, look up unused unexpired `login_tokens`,
  mark used, create session, set `sid` cookie (httpOnly, Secure in prod, SameSite=Lax,
  30 days), redirect to `/`.
- Middleware: every route except `/auth/*` and `/login-info` requires a valid session
  for a non-banned user; otherwise redirect to `/login-info` ("run `/link` in Discord").
- `POST /auth/logout` deletes the session.

**Pages**
1. `/` — subjects grouped by semester: name, code, ECTS, lecturers, material count,
   last upload.
2. `/subjects/[code]` — subject info + lecturers; topics table sortable/filterable by
   tag, date, uploader, file count.
3. `/topics/[id]` — files in the topic with inline viewer:
   pdf.js for `preview_kind=pdf`, `<img>` for images, `<pre>` for text, else download only.
   Each file: download button, uploader, date, size, "Open in Discord" link.
4. `/search?q=&subject=&tag=` — MariaDB `MATCH … AGAINST` (natural language mode)
   across `materials(original_filename, extracted_text)` and `topics(title)`;
   results show subject/topic, highlighted snippet (server-side window around first hit).
5. `/tables/[view]` — phpMyAdmin-style browser: sidebar of public views, paginated grid
   (50 rows), click-to-sort, per-column text filter, CSV export. Uses `studies_ro`.
6. `/sql` — SQL console: CodeMirror 6 editor with SQL highlighting and schema-aware
   autocomplete, run button (Ctrl+Enter), results grid, CSV export, built-in example
   queries, history in localStorage, schema sidebar listing views + columns.

**File serving**
- `GET /files/[materialId]/original` and `/files/[materialId]/preview` — session-checked,
  streamed from `STORAGE_DIR` with correct `Content-Type`, `Content-Disposition`
  (`inline` for preview, `attachment` with original filename for download), supports
  HTTP Range (needed by pdf.js for large PDFs).

**SQL console safety** (defence in depth)
1. Connection as `studies_ro` — GRANT SELECT on `v_*` views only. This is the real boundary.
2. Single statement only (`multipleStatements: false`).
3. `SET STATEMENT max_statement_time=5 FOR <query>`.
4. Result rows capped at 1000 (stream rows and stop after 1000; report "truncated").
5. Rate limit: 30 queries/min per session (in-memory).
6. Errors from MariaDB are shown to the user verbatim (they're helpful for learning SQL).

**UI**: Tailwind CSS; light/dark; Polish UI strings (single locale, no i18n framework).

## 8. Error Handling Summary

| Failure | Behaviour |
|---|---|
| Bot offline while students post | Startup catch-up ingests missed files |
| Download from Discord fails | ❌ reaction, logged, retried by next `/resync` / restart catch-up |
| Same file posted twice | Separate material rows, one file on disk, ♻️ reaction |
| LibreOffice crash/timeout | Retry ×3, then material `failed`, still downloadable |
| Worker crash mid-job | Stale lock (>10 min) re-queued |
| Discord message/thread deleted | Soft delete; hidden on site; file kept on disk |
| Malicious/slow SQL | Read-only user on views, 5 s timeout, 1000 rows, rate limit |
| Expired/invalid login link | `/login-info` page explaining to run `/link` again |
| Banned user | Sessions deleted, middleware rejects, `/link` refuses |

## 9. Testing

- **Unit (Vitest):** preview-kind/job planning from filename+mime, token hashing &
  expiry, SQL console guard (limit/truncation, error mapping), search snippet builder,
  Discord event → DB action mapping (with the Discord client mocked).
- **Integration (Vitest + MariaDB in Podman):** migrations + views; `studies_ro`
  cannot read `sessions`/`jobs` or write anything; ingest flow writes expected rows;
  worker converts a fixture DOCX/PPTX → PDF and extracts text; FULLTEXT search finds it.
- **Web (Playwright, a few smoke tests):** login via token URL, browse subject → topic,
  PDF preview loads, search returns result, SQL console runs `SELECT 1` and rejects
  `DELETE`.
- Manual: a private test Discord server for the bot end-to-end.

## 10. Local Development & Deployment

- `pnpm` (via corepack), Node 22.
- `compose.yaml` runs under **podman compose** locally; `mariadb` service always,
  app services optional (`pnpm dev` runs bot/worker/web on the host with hot reload).
- `packages/db` migration script creates schema, views, and the `studies_ro` user
  with grants.
- `.env.example` documents all variables.
- Production (later): same compose file on the home server with a `prod` profile adding
  `cloudflared` (tunnel token via env); `storage/` and MariaDB data on named volumes;
  nightly `mariadb-dump` + rsync of `storage/` as backup.

## 11. Build Order

1. `packages/db` — schema, migrations, views, read-only user, tests.
2. `apps/bot` — subject/lecturer commands, forum sync, ingest, catch-up, `/link`.
3. `apps/worker` — conversion, extraction, retries.
4. `apps/web` — auth, browse, file serving & previews, search, tables, SQL console.
5. Compose + Cloudflare Tunnel production profile.

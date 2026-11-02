# Studies DB

Studies DB mirrors a university year's Discord server into MariaDB and puts it on a website. Each subject is a forum
channel on Discord, and every post and file there shows up on the site, searchable, next to the timetable and
the year's tests, exams and other events. Students sign in with a one-time link from the bot (`/link`).

## Tutorial video


https://github.com/user-attachments/assets/d7ee41d2-e3ea-437f-8f1b-46dd12f391f6


A two-minute tour for students covering signing in, Start, semesters, subjects and files, the timetable and My
groups, events, search and installing the app, made from real screenshots of the app.

## What it does

- **Materials:** forum posts and attachments are ingested by the bot (deduplicated by sha256). The worker makes PDF
  previews (LibreOffice) and extracts text for full-text search (`pdftotext`).
- **Timetable:** classes and exams are synced from UniTime iCal feeds, one per semester 1–7. Students pick their
  group in each class (or import it from their personal UniTime link), and the week then shows only their classes.
- **Events:** any student can add tests, exams, trips and extra classes, from the website or from Discord. Each
  event gets a forum post, and students can opt in to reminder DMs. Tests and entry quizzes are marked on their
  class in the timetable.
- **Two interfaces:** a simple student UI and a phpMyAdmin-style advanced UI with a read-only SQL console and
  table browser. It installs as an app on phones.
- **Admin panel:** mirrors the bot's admin commands (subjects, lecturers, users, timetable feeds, server setup) and
  adds an audited write SQL console.

## Architecture

A pnpm monorepo. The apps never call each other: they talk only through the database (the `jobs` and
`bot_requests` tables) and a shared file volume.

| Package | What it is |
| --- | --- |
| `packages/db` | Drizzle schema, migrations and all shared domain logic |
| `apps/bot` | discord.js bot: ingestion, slash commands, `/setup`, panels, reminders |
| `apps/worker` | job queue (previews, text extraction) and the UniTime sync loop |
| `apps/web` | Next.js 16 website (App Router, React 19, Tailwind 4) |

## Getting started

You need Node.js, pnpm and Podman. The worker also needs LibreOffice (`soffice`) and `pdftotext`.

```sh
pnpm install
cp .env.example .env   # fill in the passwords and the Discord bot values
pnpm db:up             # dev MariaDB in Podman on 127.0.0.1:3307
pnpm db:migrate
pnpm db:seed           # optional example data
pnpm dev:web           # http://localhost:3000
pnpm dev:bot
pnpm dev:worker
pnpm db:login          # one-time sign-in link without Discord
```

Other commands:

```sh
pnpm test                         # all packages, sequentially
pnpm lint                         # biome
pnpm --filter @studies/web e2e    # Playwright end-to-end tests
```

## Deployment

Production runs on Podman Compose behind a Cloudflare Tunnel. See [docs/deploy.md](docs/deploy.md) and the
step-by-step runbook in [.claude/skills/server-setup/SKILL.md](.claude/skills/server-setup/SKILL.md).

## Documentation

- [CLAUDE.md](CLAUDE.md): a detailed tour of the codebase and its conventions
- [docs/glossary.md](docs/glossary.md): UI vocabulary
- [docs/superpowers/specs/](docs/superpowers/specs/): design specs for each feature

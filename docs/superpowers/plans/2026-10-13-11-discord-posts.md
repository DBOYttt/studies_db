# Discord forum posts from the DB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `/setup` posts DB topics (with files) into their forums and maintains a pinned info post per forum.

**Architecture:** Extends the /setup planner/executor: new pure renderers and actions (`postTopic`,
`upsertInfoPost`), a richer guild snapshot (thread ids, info post), new `SetupGuild` methods, and an ingestion
guard so bot-owned threads never become topics on their own.

**Tech Stack:** TypeScript, discord.js 14, drizzle-orm (MariaDB), vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-discord-setup-design.md` (Addendum 2)

## Global Constraints

- Upload limits: 10 files/message, 10 MiB (10 * 1024 * 1024 B) per file; max 5 applied tags per post.
- Info post title exactly `ℹ️ Informacje o przedmiocie`; content ≤ 2000 chars.
- Links: `${webBaseUrl}/files/<id>/original`, `${webBaseUrl}/s/subjects/<CODE>`, `${webBaseUrl}/s/plan`.
- Weekdays: `pon.`, `wt.`, `śr.`, `czw.`, `pt.`, `sob.`, `niedz.`; session times are wall Dates (UTC fields).

## Review Focus

- A topic whose files are all over 10 MiB → post still created, message lists links, no upload → test in Task 3.
- Two topics with the same title in one forum → both posted, linked to their own threads → test in Task 3.
- Subject with no sessions / no lecturers → info post renders without empty headings → test in Task 2.
- Bot thread event arriving before /setup links it → no duplicate topic → test in Task 1.
- Topic with zero files → post with only the header line → test in Task 3.

---

### Task 1: Ingestion guard for bot-owned threads
**Files:** `apps/bot/src/types.ts` (`ThreadInfo.ownerIsBot: boolean`), `src/discord/map.ts` (`toThreadInfo`:
`thread.ownerId === thread.client.user?.id`), `src/sync.ts` (`upsertTopic`), test `test/sync.test.ts` (+ fixtures
that build ThreadInfo get `ownerIsBot: false`).
- [ ] Tests: bot-owned unknown thread → `upsertTopic` returns null, no row; bot-owned thread already linked →
  title updated, `created_by` unchanged even with an owner passed.
- [ ] Run → FAIL; implement; run bot suite → PASS; commit `fix(bot): never auto-create topics for bot-owned threads`.

### Task 2: Info post renderer + richer specs
**Files:** `src/setup/types.ts` (LecturerSpec + `email`, `officeHours`, `room`; `SessionSpec`;
`TopicSpec`/`MaterialSpec`; `SubjectSpec.topics?`, `SubjectSpec.sessions?`), `src/setup/info.ts`
(`INFO_TITLE`, `renderInfoPost(s: SubjectSpec, webBaseUrl: string): string`), `src/setup/load.ts`
(`loadSubjectSpecs(db, now = new Date())` fills lecturer contacts, topics with ready non-deleted materials, uploader
name, and sessions with `startsAt` in [now-wall, now-wall + 14 d)), tests `test/setup-info.test.ts`,
`test/setup-apply.test.ts` (loader).
- [ ] Tests: content per spec (header, links, lecturer fields, `pon. 08:00–09:30 · Wykład · A-1 101`, one line per
  uid, `odwołane: 2026-10-20 Wykład`), no `null`/`undefined`/empty `Plan zajęć` heading when no sessions, ≤ 2000 with
  `Więcej:`; loader returns topics/materials/sessions.
- [ ] Run → FAIL; implement; run → PASS; commit `feat(bot): subject info post renderer and loader data`.

### Task 3: Planner + executor for posts and info post
**Files:** `src/setup/types.ts` (ForumSnapshot + `threadIds: string[]`, `infoPost: { threadId, messageId, content,
pinned } | null`; actions `postTopic { subjectId, code, channelId, topicId, title, tagIds, messages: { content,
files: { materialId, name, storagePath }[] }[] }` and `upsertInfoPost { subjectId, code, channelId, content,
existing: { threadId, messageId, pinned, same: boolean } | null }`), `src/setup/plan.ts` (`planSetup(..., opts?: {
webBaseUrl: string })`: topic/info actions only when `opts` given), `src/setup/apply.ts` (`SetupGuild` +
`createThread`, `sendMessage`, `editMessage`, `pinThread`; `applySetup(db, guild, actions, snapshot, storageDir =
'')`), `src/setup/report.ts`, tests in `test/setup-plan.test.ts`, `test/setup-apply.test.ts`.
- [ ] Tests (planner): unposted topic → `postTopic` with tags mapped/capped at 5, header line, files chunked by 10,
  >10 MiB as link line; already-posted (thread id in `threadIds`) → nothing; forum missing → nothing; info missing →
  create, same content & pinned → nothing, different → edit.
- [ ] Tests (executor, fake guild + test DB): thread/message ids saved to topic and materials by order; missing file
  → failure, next topic still posted; follow-up message for 11 files; info post create pins, edit edits.
- [ ] Run → FAIL; implement; run → PASS; commit `feat(bot): /setup posts DB topics and info posts`.

### Task 4: discord.js adapter + router + docs
**Files:** `src/setup/discord.ts` (snapshot: per forum active+archived thread ids, bot info thread via title +
`ownerId === client.user.id`, starter content, `ChannelFlags.Pinned`; methods via `forum.threads.create({ name,
appliedTags, message: { content, files } })`, `thread.fetchStarterMessage()`, `thread.send`, `message.edit`,
`thread.pin()`), `src/commands/router.ts` (pass opts `{ webBaseUrl }`, `storageDir`; second pass when pass 1 had
`createForum` or `importForum`), `apps/bot/README.md`, test `test/router.test.ts`.
- [ ] Test: second pass runs after `createForum` (not only import).
- [ ] Run → FAIL; implement; full bot suite + typecheck + lint → PASS; commit `feat(bot): wire /setup posts`.

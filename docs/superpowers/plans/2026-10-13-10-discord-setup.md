# Discord `/setup` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin slash command `/setup [dry_run]` that builds the Discord side (semester categories, one forum per subject with class/group tags and generated guidelines, admin role) from the DB, idempotently.

**Architecture:** Pure planner (`desiredState` + `planSetup`: DB specs + guild snapshot → `Action[]`) and a sequential executor over a narrow `SetupGuild` interface with a discord.js implementation. The admin role is now resolved by name (`ADMIN_ROLE_NAME`).

**Tech Stack:** TypeScript (NodeNext ESM), discord.js 14, drizzle-orm (MariaDB), vitest 5, Biome.

**Spec:** `docs/superpowers/specs/2026-10-13-discord-setup-design.md`

## Global Constraints

- `ADMIN_ROLE_ID` removed; `ADMIN_ROLE_NAME` optional, default `Studies Admin`; `BotConfig.adminRoleName`.
- `/setup` allowed for admin role holders **or** Manage Server; all other admin commands stay role-only.
- Forum name: `slug(code + '-' + name)`: lowercase, diacritics stripped (`stripMarks` from `@studies/db`), non-`[a-z0-9]` runs → `-`, trimmed of `-`, max 100 chars.
- Category name: `Semestr ${semester}`, matched by exact name.
- Desired tags in order: `CLASS_NAMES[kind]` per class, `Gr. 1`…`Gr. N` (`groupName(n)`, N = max group number), `Kolokwium`, `Egzamin`. Tag match = `stripMarks(name.trim()).toLowerCase()`. Max 20 tags per forum. Never remove/rename tags.
- Guidelines max 4096 chars; replies max 2000 chars (existing `truncate` pattern); new bot permission integer `275146409040`.
- Never create a forum for a subject whose linked channel is not found — warn and skip.
- User-facing strings in Polish, like the rest of the bot.

## Review Focus

- Every generated class/group tag name must classify back through `classifyTags` to the same kind/number, otherwise posts land unfiled → roundtrip test in Task 2.
- Subject with no classes → tags only `Kolokwium`, `Egzamin`; guidelines still render without empty headings → tests in Tasks 2 and 3.
- Existing forum already holding user tags close to 20 → plan never asks to exceed 20 total → test in Task 2.
- Long / diacritic-heavy subject names (`Język angielski B2 — ćwiczenia…` > 100 chars) → valid slug ≤ 100 chars, no leading/trailing `-` → test in Task 2.
- Null lecturer title, missing platform URLs, null assessment → no `null`/`undefined` text in guidelines → test in Task 3.

---

### Task 1: Admin role by name

**Files:**
- Modify: `apps/bot/src/config.ts`, `apps/bot/src/commands/router.ts:41-67,112` (`isAdmin` + check)
- Modify: `.env.example`, `.env.prod.example` (replace `ADMIN_ROLE_ID=` line with `# ADMIN_ROLE_NAME=Studies Admin` + comment that it's optional)
- Test: `apps/bot/test/config.test.ts`, `apps/bot/test/router.test.ts`

**Interfaces:**
- Produces: `BotConfig.adminRoleName: string`; `isAdmin(i: ChatInputCommandInteraction, roleName: string): boolean`; `canRunSetup(i, roleName): boolean` (exported from router, used in Task 5).

- [ ] **Step 1: Update tests.** config: missing-vars message is `'Missing env: DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, WEB_BASE_URL, DATABASE_URL, STORAGE_DIR'`; complete env without `ADMIN_ROLE_*` → `adminRoleName === 'Studies Admin'`; `ADMIN_ROLE_NAME: 'Mods'` → `'Mods'`. router `isAdmin`: with `guild: { roles: { cache: new Map([['r', { id: 'r', name: 'Studies Admin' }]]) } }` array roles `['r']` → true, `['a']` → false; cache roles `{ cache: new Map([['r', {}]]) }` → true; no role with that name in guild → false; `member: null` → false. Router `config` fixture becomes `{ adminRoleName: 'Studies Admin', … }` and `mkInteraction` gets that `guild` by default. `canRunSetup`: member without role but `memberPermissions: { has: () => true }` → true; neither → false.
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run test/config.test.ts test/router.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `loadConfig` keeps the required list minus `ADMIN_ROLE_ID` and sets `adminRoleName: env.ADMIN_ROLE_NAME || 'Studies Admin'`. `isAdmin` finds `i.guild?.roles.cache.find(r => r.name === roleName)` and checks its id against the member's roles (both shapes). `canRunSetup = isAdmin(...) || i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true`. Router check uses `deps.config.adminRoleName`.
- [ ] **Step 4: Run** same command → PASS; `pnpm --filter @studies/bot typecheck` → clean.
- [ ] **Step 5: Commit** `feat(bot): resolve admin role by name (ADMIN_ROLE_NAME)`.

### Task 2: Planner

**Files:**
- Create: `apps/bot/src/setup/types.ts`, `apps/bot/src/setup/plan.ts`
- Test: `apps/bot/test/setup-plan.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  type LecturerSpec = { name: string; title: string | null; group: number | null };
  type ClassSpec = { kind: ClassKind; name: string; assessment: Assessment | null;
    assessmentNote: string | null; platformUrl: string | null; groups: number[]; lecturers: LecturerSpec[] };
  type SubjectSpec = { id: number; code: string; name: string; semester: number; ects: number;
    platformUrl: string | null; channelId: string | null; classes: ClassSpec[] };
  type ForumSnapshot = { id: string; name: string; parentId: string | null; tags: ForumTag[]; topic: string | null };
  type GuildSnapshot = { categories: { id: string; name: string }[]; forums: ForumSnapshot[];
    roles: { id: string; name: string }[]; callerId: string; callerRoleIds: string[] };
  type Action =
    | { type: 'createRole'; name: string }
    | { type: 'assignRole'; roleName: string; userId: string }
    | { type: 'createCategory'; name: string }
    | { type: 'createForum'; subjectId: number; code: string; name: string; categoryName: string; tags: string[]; topic: string }
    | { type: 'addTags'; subjectId: number; code: string; channelId: string; tags: string[] }
    | { type: 'setGuidelines'; subjectId: number; code: string; channelId: string; topic: string }
    | { type: 'warn'; code: string | null; message: string };
  ```
- Produces (`plan.ts`): `forumSlug(code: string, name: string): string`; `desiredTags(s: SubjectSpec): string[]`; `tagKey(name: string): string`; `planSetup(subjects: SubjectSpec[], g: GuildSnapshot, roleName: string, render: (s: SubjectSpec) => string): Action[]` (render injected so this task does not depend on Task 3; Task 5 passes `renderGuidelines`).

- [ ] **Step 1: Write failing tests** (fixture: ASD sem 3 with wyklad + laboratorium groups [1,2,3]; BD sem 3 linked to `f-bd`; render = `s => 'G:' + s.code`):
  - `forumSlug('ASD','Algorytmy i struktury danych') === 'asd-algorytmy-i-struktury-danych'`; `forumSlug('JA','Język angielski — ćwiczenia ' + 'x'.repeat(200))` has length ≤ 100, matches `/^[a-z0-9]+(-[a-z0-9]+)*$/`, starts `ja-jezyk-angielski-cwiczenia`.
  - `desiredTags(ASD)` equals `['Wykład','Laboratorium','Gr. 1','Gr. 2','Gr. 3','Kolokwium','Egzamin']`; subject with no classes → `['Kolokwium','Egzamin']`.
  - roundtrip: for every `kind` in `CLASS_KINDS` and n in 1..12, `classifyTags([CLASS_NAMES[kind], groupName(n)])` → `{ classKind: kind, groupNumber: n }`.
  - empty guild, ASD unlinked → actions in order: `createRole('Studies Admin')`, `assignRole`, `createCategory('Semestr 3')`, `createForum` with `name 'asd-algorytmy-i-struktury-danych'`, `categoryName 'Semestr 3'`, the 7 tags, `topic 'G:ASD'`.
  - role exists and caller has it → no role actions; category `Semestr 3` exists → no `createCategory`.
  - BD linked, forum `f-bd` present with tags `[{id:'1',name:'wyklad'}]` and topic `'old'` → `addTags` without `Wykład` (match ignores case/diacritics) and `setGuidelines` topic `'G:BD'`; same topic already → no `setGuidelines`; all tags present → no `addTags`.
  - BD linked but `f-bd` absent → exactly one `warn` with code `'BD'` and no other BD actions.
  - forum with 18 existing unrelated tags → `addTags.tags.length === 2` plus a `warn` naming the dropped tags; unlinked subject wanting 23 tags → `createForum.tags.length === 20` + `warn`.
  - idempotence: build a snapshot that reflects applying the first plan (role present, caller has it, category present, forum with all tags and topic, subject linked) → `planSetup` returns `[]`.
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run test/setup-plan.test.ts` → FAIL.
- [ ] **Step 3: Implement** `types.ts` and `plan.ts` (no discord.js or DB imports except types/constants from `@studies/db`). Subjects processed sorted by `(semester, code)`; categories created at most once per name.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(bot): /setup planner`.

### Task 3: Guidelines text

**Files:**
- Create: `apps/bot/src/setup/guidelines.ts`
- Test: `apps/bot/test/setup-guidelines.test.ts`

**Interfaces:**
- Consumes: `SubjectSpec` (Task 2).
- Produces: `renderGuidelines(s: SubjectSpec): string` (≤ 4096 chars).

- [ ] **Step 1: Write failing tests:** output contains `Algorytmy i struktury danych`, `Semestr 3`, `6 ECTS`, the subject platform URL, `Laboratorium`, `Sprawozdania` (from `ASSESSMENT_NAMES`), `dr inż. Tomasz Zieliński`, `mgr Michał Kamiński (Gr. 3)`, and a line containing `Gr.` explaining tagging; spec with null title / null URLs / null assessment / no classes contains neither `null` nor `undefined` and has no empty class section; a spec with 300 classes-worth of lecturers yields length ≤ 4096.
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run test/setup-guidelines.test.ts` → FAIL.
- [ ] **Step 3: Implement** as plain-text lines (header `name — Semestr N, X ECTS`, optional `Platforma: url`, one block per class: `Wykład — Egzamin (note)`, `Prowadzący: …`, optional link; closing line `Oznaczaj posty tagiem zajęć i grupy, np. Laboratorium + Gr. 1.`); truncate to 4096 with `…`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(bot): /setup forum guidelines`.

### Task 4: Load from DB + apply

**Files:**
- Create: `apps/bot/src/setup/load.ts`, `apps/bot/src/setup/apply.ts`, `apps/bot/src/setup/report.ts`, `apps/bot/src/setup/discord.ts`
- Test: `apps/bot/test/setup-apply.test.ts`

**Interfaces:**
- Consumes: Task 2 types/actions; `syncForumTags` (`src/sync.ts`).
- Produces:
  - `loadSubjectSpecs(db: Db): Promise<SubjectSpec[]>` (classes with groups sorted, lecturers via `class_lecturers` + `class_groups.number`).
  - `interface SetupGuild { createRole(name: string): Promise<string>; addRoleToMember(userId: string, roleId: string): Promise<void>; createCategory(name: string): Promise<string>; createForum(o: { name: string; parentId: string; tags: string[]; topic: string }): Promise<{ id: string; tags: ForumTag[] }>; addForumTags(channelId: string, names: string[]): Promise<ForumTag[]>; setForumTopic(channelId: string, topic: string): Promise<void> }` — `addForumTags` returns the forum's full tag list after the change.
  - `type SetupReport = { created: string[]; updated: string[]; warnings: string[]; failures: string[] }`.
  - `applySetup(db: Db, guild: SetupGuild, actions: Action[], snapshot: GuildSnapshot): Promise<SetupReport>`.
  - `formatReport(r: SetupReport): string`, `formatPlan(actions: Action[]): string` (header `Plan (bez zmian):`; empty → `Wszystko jest aktualne.`), both truncated to 2000.
  - `discordSetupGuild(guild: Guild): SetupGuild`, `snapshotGuild(guild: Guild, callerId: string): Promise<GuildSnapshot>` (in `discord.ts`; not unit-tested).
- [ ] **Step 1: Write failing tests** (test DB via `resetTestDb`, fake `SetupGuild` recording calls and returning ids `cat-1`, `forum-1`, tags with ids `t-<name>`):
  - `loadSubjectSpecs` returns ASD with classes `wyklad` (groups `[]`) and `laboratorium` (groups `[1,2,3]`), lecturer with `group: 3` for a group-scoped assignment.
  - applying a `createCategory` + `createForum` plan: `subjects.discord_channel_id` for ASD becomes `forum-1`; `tags` rows for ASD match the returned tags; forum created with `parentId 'cat-1'`; report.created mentions `ASD`.
  - `createForum` for subject A throws `new Error('Missing Permissions')` → report.failures has a line with `A` and `Missing Permissions`; subject B's forum still created and linked.
  - `createForum` succeeds but linking hits a duplicate channel id → failure line, no throw.
  - `assignRole` after `createRole` uses the newly created role id.
  - `formatPlan([])` → `'Wszystko jest aktualne.'`; a 500-action plan formats to ≤ 2000 chars.
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run test/setup-apply.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Executor keeps `Map` name→id for categories/roles seeded from the snapshot; each action in `try/catch`; on a subject failure, later actions for the same `subjectId` are skipped with no extra line; forum id written to DB immediately after `createForum`, then `syncForumTags`. `discord.ts`: `guild.channels.create({ type: ChannelType.GuildCategory })`, `({ type: ChannelType.GuildForum, parent, topic, availableTags: names.map(name => ({ name })) })`, `ForumChannel.setAvailableTags([...existing, ...new])`, `setTopic`, `guild.roles.create({ name })`, `guild.members.addRole`; snapshot from `guild.channels.fetch()` and `guild.roles.fetch()` and the caller's member roles.
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(bot): /setup executor and DB loader`.

### Task 5: Command wiring + docs

**Files:**
- Modify: `apps/bot/src/commands/definitions.ts` (add `setup` with boolean `dry_run`, `setDefaultMemberPermissions(ManageGuild)`), `apps/bot/src/commands/router.ts` (`setup` case + permission check via `canRunSetup` before the generic admin check)
- Modify: `apps/bot/README.md` (env, invite URL `permissions=275146409040` = previous + Manage Channels + Manage Roles, bot role above admin role, `/setup` step, manual checklist items, concurrent-run note), `docs/deploy.md` (upgrade note: `ADMIN_ROLE_ID` → `ADMIN_ROLE_NAME` or rename role to `Studies Admin`; re-run `register`), `CLAUDE.md` (bot section: `/setup`)
- Test: `apps/bot/test/router.test.ts`, `apps/bot/test/commands.test.ts` (if it asserts the command list)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write failing tests:** `/setup` from a member with Manage Server but no role is not refused (reply is not `'Brak uprawnień.'`; `deferReply` called with ephemeral flag); `/setup` from neither → `'Brak uprawnień.'`; `/subject list` from Manage-Server-only member → `'Brak uprawnień.'`; command definitions include `setup`.
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run test/router.test.ts test/commands.test.ts` → FAIL.
- [ ] **Step 3: Implement** the `setup` case: `deferReply(eph)`, `snapshotGuild(i.guild, i.user.id)`, `loadSubjectSpecs(db)`, `planSetup(..., deps.config.adminRoleName, renderGuidelines)`; dry run → `editReply(formatPlan(actions))`; else `applySetup(db, discordSetupGuild(i.guild), actions, snapshot)` → `editReply(formatReport(r))`. The router test for the allowed path stubs `guild` so `snapshotGuild` returns an empty snapshot and the DB has no subjects.
- [ ] **Step 4: Run** full suite `pnpm --filter @studies/bot test`, `pnpm --filter @studies/bot typecheck`, `pnpm lint` → all pass.
- [ ] **Step 5: Commit** `feat(bot): /setup command and docs`.

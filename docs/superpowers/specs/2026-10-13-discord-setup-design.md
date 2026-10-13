# Discord server setup from the database (`/setup`)

Date: 2026-10-13. Status: design approved in chat (parts 1–3), pending spec review.

## Intent

The user asked for the bot to "set up all needed things based on information in
the database". Today an admin builds the Discord side by hand: one forum channel
per subject, the exact class/group tags the hierarchy classifier expects, and
then `/subject add` to link each forum. Subjects created by the UniTime import
or the dev seed have no forum at all (`discord_channel_id IS NULL`).

Success: on a fresh server, one `/setup` run leaves every subject with a linked
forum under a `Semestr N` category, carrying class/group tags and generated
guidelines, plus the admin role. Posts in those forums are then filed under the
right class/group with no further manual work. Running it again only fills in
what is missing.

Agreed in chat:

- Trigger: admin slash command `/setup [dry_run]` (not a CLI script).
- Scope: forums + tags, semester categories, forum guidelines text, admin role.
- Admin role is looked up **by name** (`ADMIN_ROLE_NAME`), replacing
  `ADMIN_ROLE_ID`.
- Approach: pure planner (desired state + guild snapshot → actions) and a
  separate executor.
- Forum names include the subject name: `<code>-<name>`.

## Configuration and permissions

- `ADMIN_ROLE_ID` is removed. New optional `ADMIN_ROLE_NAME`, default
  `Studies Admin`. `BotConfig.adminRoleId` becomes `adminRoleName`; it is no
  longer in the required-variable list.
- `isAdmin(interaction, roleName)` resolves the role ID by name from
  `interaction.guild.roles.cache` (case-sensitive exact name; the guild is
  cached through the `Guilds` intent) and then checks the member's roles by ID,
  for both the cached (`GuildMemberRoleManager`) and raw (`string[]`) member
  shapes. No role with that name → not admin.
- `/setup` is allowed for admins **or** members with the Manage Server
  permission (`i.memberPermissions?.has(ManageGuild)`), so the first run can
  create the role. Every other admin command stays role-only.
- `/setup` is registered with `setDefaultMemberPermissions(ManageGuild)` like
  the other admin commands.
- The bot additionally needs **Manage Channels** and **Manage Roles**. Invite
  permission integer: `274877973568` → `275146409040`. The bot's own role must
  be above the admin role in the server's role list to assign it.
- Docs updated: `.env.example`, `.env.prod.example`, `apps/bot/README.md`
  (setup steps, invite URL, manual checklist), `docs/deploy.md` (upgrade note:
  replace `ADMIN_ROLE_ID` with `ADMIN_ROLE_NAME`, or rename the existing role
  to `Studies Admin`; re-run `register`).

## What `/setup` builds

Inputs: DB subjects with their classes (kind, name, assessment, assessment
note, platform URL), groups and class lecturers; the guild's channels and roles
fetched once at the start.

Subjects are processed in `(semester, code)` order.

1. **Category** `Semestr N` (N = `subjects.semester`). Matched by exact name
   among the guild's categories; created if missing. Used only as the parent of
   newly created forums.
2. **Forum**
   - Unlinked subject: create a forum named `slug(code + '-' + name)`
     (lowercase, Polish diacritics transliterated, non-alphanumerics → `-`,
     collapsed, trimmed, max 100 chars) inside its category, with the desired
     tags and guidelines; immediately store its ID in
     `subjects.discord_channel_id`.
   - Linked and the channel exists in the guild snapshot as a forum: keep it;
     never rename or move it.
   - Linked but not found (or not a forum): emit a warning and skip the
     subject. Never create a duplicate (the bot may simply lack View Channel).
3. **Tags.** Desired set, in this order:
   - one per class: `CLASS_NAMES[kind]` (`Wykład`, `Laboratorium`, …);
   - `Gr. 1` … `Gr. N`, N = highest group number across the subject's classes
     (none if the subject has no groups);
   - `Kolokwium`, `Egzamin`.
   A desired tag is "present" if an existing tag matches after trimming,
   lowercasing and stripping diacritics. Only missing tags are added; existing
   tags are never removed or renamed. Discord allows at most 20 tags per forum:
   add what fits in desired order and warn about the rest. After a forum's tags
   change (or it is created), run the existing `syncForumTags` for the subject.
4. **Guidelines.** The forum topic is regenerated from the DB on every run
   (overwriting manual edits; only written when the text differs). Content:
   name, semester, ECTS; subject platform link; each class with its assessment
   (+ note), platform link and lecturers (`title name`, group-specific ones
   suffixed `(Gr. N)`); a closing line on tagging posts with class + group.
   Truncated to Discord's 4096-character limit.
5. **Admin role.** If no role named `ADMIN_ROLE_NAME` exists, create it; if the
   caller lacks it, add it to the caller.

Reply (ephemeral, `deferReply` first): lists created / updated / skipped /
warnings / failures, truncated to 2000 characters like other replies.
`dry_run:true` builds the same plan, applies nothing, and replies with it.

Not guarded: two concurrent `/setup` runs. The unique index on
`discord_channel_id` prevents double-linking, but a race could leave an orphan
forum; documented in the README.

## Structure

All new code in `apps/bot/src/setup/`:

- `plan.ts` (pure; no discord.js or DB imports):
  - `type SubjectSpec` (from DB) and `type GuildSnapshot` (`categories`,
    `forums` with id/name/parentId/tags/topic, `roles`, `callerRoleIds`).
  - `desiredState(subjects): DesiredSubject[]` (tags, forum name, category
    name, guidelines text).
  - `planSetup(desired, snapshot, roleName): Action[]` where
    `Action = createRole | assignRole | createCategory | createForum | addTags |
    setGuidelines | warn`. Actions that depend on a new category reference it
    by name, resolved by the executor.
- `guidelines.ts` (pure): `renderGuidelines(subject): string`.
- `apply.ts`: `applySetup(db, guild: SetupGuild, actions): SetupReport`, run
  sequentially. A failing action records its Discord error message against the
  subject and moves on; actions for that subject that depend on it are
  skipped. `SetupGuild` is a narrow interface (create category, create forum,
  set tags, set topic, create role, add role to member, read back tags) with
  the discord.js implementation alongside.
- `load.ts`: DB query building `SubjectSpec[]`; `snapshotGuild(guild,
  callerId)` from discord.js objects.
- `report.ts` (pure): `formatReport(report | actions, dryRun): string`.
- Router/definitions: `/setup` definition with boolean `dry_run`; handler wires
  load → plan → (apply) → reply; permission check as above.

## Error handling

- Missing permissions or role-hierarchy errors surface as per-subject failure
  lines with Discord's message; nothing aborts the whole run.
- Forum ID is written to the DB right after creation, so a crash never leaves a
  forum the DB does not know about. A later run then sees it as linked.
- A duplicate-key error when linking (concurrent run) is reported as a failure
  for that subject.

## Testing

- `test/setup-plan.test.ts` (plain objects): empty guild → full plan; second
  run on the resulting snapshot → no actions; linked-but-missing channel →
  warning only; 20-tag cap with warning; existing category reused; tag match
  ignoring case and diacritics; role created and assigned; caller already has
  role → no assign; subject without groups → no `Gr.` tags; slug rules.
- `test/setup-guidelines.test.ts`: content (lecturers, group suffix, links,
  assessment) and the 4096 cap.
- `test/setup-apply.test.ts`: fake `SetupGuild` + test DB: channel IDs stored,
  tags synced to `tags`, one failing subject does not stop others, dry run
  changes nothing.
- `test/router.test.ts`: `/setup` allowed by Manage Server or role; other admin
  commands still need the role; role resolved by name.
- `test/config.test.ts`: `ADMIN_ROLE_NAME` default, `ADMIN_ROLE_ID` no longer
  required.
- No live-Discord test: add `/setup` steps to the README manual checklist
  (fresh server run, re-run is a no-op, guidelines visible, posts tagged
  class + group land in the right place).

## Out of scope

Deleting or renaming forums/tags, moving existing forums between categories,
per-channel permission overwrites, channels other than subject forums,
unlinking a subject from its channel.

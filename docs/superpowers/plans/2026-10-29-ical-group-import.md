# Import My groups from UniTime: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a student fills My groups from their personal UniTime iCalendar, either a link or a `.ics` file, on the web (both modes) and from the Discord `#panel`.

**Architecture:**
- **Shared logic** lives in `packages/db/src/unitime/`:
  - the hardened fetch, moved out of the worker;
  - the import URL guard;
  - `planGroupImport` (preview, read-only);
  - `applyGroupImport` (merge write).
- **Web:** two server actions (preview, apply) and one client component in `GroupsTab`.
- **Bot:** a button and a modal in the My groups view that apply immediately.

**Tech stack:** TypeScript, Drizzle/MariaDB, Next 16 server actions, discord.js 14 Components V2, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-ical-group-import-design.md`

## Global Constraints

- **The calendar URL is never stored or logged:**
  - error messages name the host only, as `SafeSyncError` does;
  - the URL is never returned to the client;
  - it never appears in a `console.*` call.
- **Import fetch:**
  - https only;
  - the host is in `UNITIME_IMPORT_HOSTS` (comma-separated, default `plan.agh.edu.pl`) or is the host of `UNITIME_ICAL_URL` / `UNITIME_EXAM_ICAL_URL`;
  - lowercase compare;
  - no port other than 443 (or none);
  - no userinfo;
  - 2 MiB (`2 * 1024 * 1024`);
  - 15 s timeout (`15_000`);
  - `text/calendar` content type;
  - the existing same-host redirect rule.
- **Uploaded `.ics`:** max 2 MiB, held in memory only, never written to `STORAGE_DIR`.
- **Rate limit:** 6 imports per user per 10 minutes (`6`, `10 * 60_000`). Previews and file uploads count. The message is exactly `Too many imports. Try again in a few minutes.`
- **The import never creates** subjects, classes or groups.
- **Matching:**
  - subject by `subjects.unitime_name` with `deleted_at IS NULL`;
  - class by `(subject_id, kind)`;
  - group by `(class_id, number)`.
- **Apply:**
  - merges and never clears other classes;
  - `pairs` is capped at 100;
  - invalid pairs are skipped.
- **Exact copy:**
  - no classes: `This calendar has no classes yet. UniTime may not have published your timetable; try again later or pick your groups below.`
  - not iCalendar: `That is not a UniTime calendar (.ics).`
- **Language:**
  - UI strings are English; `pnpm check:lang` must pass;
  - subject, class and group names are shown as stored.
- **Commits:**
  - commit with `git -c commit.gpgsign=false commit …`, as DBOYttt, with no AI attribution or Co-Authored-By trailers;
  - never push;
  - work only in this worktree.
- **Data:** DB tests use `resetTestDb()` and run sequentially. Never touch the `studies` dev DB.
- **Bot custom_ids:** `v1:stu:groups:import` (button → modal) and `v1:stu:groups:importsubmit` (modal). The text input is labelled `UniTime calendar link`, max 500.

## Review Focus

1. **A pasted URL with whitespace or a `webcal://` scheme:** trim it, and map `webcal://` to `https://` before the guard. Test it in Task 1.
2. **A feed with CRLF line endings or folded lines:** `parseIcs` already handles them. The Task 2 fixture uses CRLF.
3. **A subject that exists only soft-deleted:** report it as unmatched (reason `subject`), never match it. Test it in Task 2.
4. **The same class in the feed under two kinds' prefixes** (`CWA` and `Ćwiczenia audytoryjne`): these are one kind, so their occurrences add up for that class. Test it in Task 2.
5. **Apply pairs that were tampered with** (a group of another class, ids that are not ints, more than 100 pairs): skip them and count them, no throw. Test it in Tasks 2 and 3.

---

### Task 1: Shared fetch and import URL guard

**Files:**
- Create: `packages/db/src/unitime/fetch.ts`
- Modify: `packages/db/src/unitime/index.ts`, which exports `./fetch.js`.
- Modify: `apps/worker/src/plan-sync.ts`.
  - Delete `SafeSyncError`, `fetchSameHost`, `fetchTimetable` and their constants.
  - Import them from `@studies/db`, and re-export `fetchTimetable` and `SafeSyncError` so `apps/worker/test/plan-sync.test.ts` keeps working unchanged.
  - The worker's defaults stay 30 s and 5 MiB.
- Test: `packages/db/test/unitime-fetch.test.ts`

**Interfaces:**
- Produces:
  - `class SafeSyncError extends Error`;
  - `fetchTimetable(url: string, o?: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch }): Promise<string>`, behaviour unchanged;
  - `importAllowedHosts(env?: NodeJS.ProcessEnv): string[]`;
  - `normalizeImportUrl(raw: string, allowedHosts: readonly string[]): { ok: true; url: string; host: string } | { ok: false; error: string }`;
  - `fetchImportCalendar(url: string, o?: { fetchImpl?: typeof fetch }): Promise<string>`, i.e. `fetchTimetable` with `timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024`;
  - `IMPORT_MAX_BYTES = 2 * 1024 * 1024`.

- [ ] **Step 1: Write failing tests in `unitime-fetch.test.ts`**
  - **`importAllowedHosts`:**
    - with `{}`, it returns `['plan.agh.edu.pl']`;
    - with `{ UNITIME_IMPORT_HOSTS: 'A.example, b.example', UNITIME_ICAL_URL: 'https://feed.example/x?t=1' }`, it returns the set `a.example`, `b.example`, `feed.example` (no duplicates).
  - **`normalizeImportUrl`, accepted (with hosts `['plan.agh.edu.pl']`):**
    - `'  https://plan.agh.edu.pl/UniTime/export?x=abc  '` gives ok, with that url trimmed;
    - `'webcal://plan.agh.edu.pl/UniTime/export?x=abc'` gives ok, with the url `https://plan.agh.edu.pl/UniTime/export?x=abc`;
    - `'https://PLAN.agh.edu.pl:443/x'` gives ok.
  - **`normalizeImportUrl`, rejected:**
    - `'http://plan.agh.edu.pl/x'` gives `{ ok: false, error: 'Use an https:// link from plan.agh.edu.pl.' }`;
    - `'https://evil.example/x'` gives `{ ok: false, error: 'Only links from plan.agh.edu.pl can be imported.' }`;
    - `'https://u:p@plan.agh.edu.pl/x'` is rejected;
    - `'https://plan.agh.edu.pl:8443/x'` is rejected;
    - `'not a url'` gives `{ ok: false, error: 'That is not a link.' }`;
    - a URL longer than 500 chars is rejected.
    - The host listed in the error messages is the first allowed host.
  - **No URL in errors:** no error string contains `abc` (the query) or the path.
  - **`fetchImportCalendar`:** with a fake `fetchImpl`, a body over 2 MiB throws `SafeSyncError` "The response from plan.agh.edu.pl is too large".
- [ ] **Step 2:** Run `pnpm --filter @studies/db exec vitest run test/unitime-fetch.test.ts`. It must FAIL (module not found).
- [ ] **Step 3:** Move the fetch code verbatim and implement the three new functions.
- [ ] **Step 4:** Run the new test and `pnpm --filter @studies/worker exec vitest run test/plan-sync.test.ts`. Both must PASS. Then `pnpm --filter @studies/worker typecheck` and `pnpm --filter @studies/db typecheck`.
- [ ] **Step 5:** Commit: `feat(db): share the UniTime fetch and add the import link guard`.

### Task 2: planGroupImport and applyGroupImport

**Files:**
- Create: `packages/db/src/unitime/group-import.ts`, exported from `unitime/index.ts`.
- Create: `packages/db/test/fixtures/personal.ics` (CRLF), with these VEVENTs:
  - `Chemia ogólna (1rok)`:
    - `CWA 2c` weekly, ×4 occurrences (RRULE with UNTIL);
    - `Ćwiczenia audytoryjne 2` ×1 (the same class as CWA, so it adds to group 2);
    - `CWL 3` ×4;
    - `Wykład 1` ×4.
  - `Programowanie w języku Python (1rok)`:
    - `Laboratorium 1` ×2;
    - `Laboratorium 4` ×2 (a tie, so ambiguous).
  - `Nieznany przedmiot (1rok)`: `CWA 1` (no subject).
  - `Algebra liniowa (1rok)`: `Projekt 1` (the subject exists but has no projekt class).
  - `Analiza matematyczna (1rok)`: `CWA 9` (no group 9).
  - `Egzamin: Chemia ogólna (1rok)`: exam, skipped.
  - `Przemysł 4.0 (1rok)`: DESCRIPTION `Konsultacje` (no kind, skipped).
  - `Chemia ogólna (1rok)`: `Seminarium` with no number (no group, skipped).
  - `Usunięty (1rok)`: `CWA 1`. Its subject is soft-deleted in the test setup.
- Create: `packages/db/test/fixtures/personal-empty.ics`, the VCALENDAR with only `X-WR-CALNAME:Personal Schedule` and no VEVENT.
- Test: `packages/db/test/group-import.test.ts`, DB-backed.

**Interfaces:**
- Consumes: `parseIcs`, `classifyEvent`, `expandOccurrences` (existing); `getMyGroups` (`my-groups.ts`).
- Produces:

```ts
export interface GroupImportPreview {
  calendarName: string | null;
  totalEvents: number;
  matched: { classId: number; groupId: number; subjectName: string; className: string; groupName: string; currentGroupId: number | null }[];
  ambiguous: { classId: number; subjectName: string; className: string; groupNames: string[] }[];
  unmatched: { subjectName: string; label: string; reason: 'subject' | 'class' | 'group' }[];
  skipped: { exam: number; noKind: number; noGroup: number };
}
export class NotACalendarError extends Error {}
export function planGroupImport(db: Db, userId: number, icsText: string): Promise<GroupImportPreview>;
export function applyGroupImport(db: Db, userId: number, pairs: { classId: number; groupId: number }[]): Promise<{ set: number; skipped: number }>;
export const GROUP_IMPORT_MAX_PAIRS = 100;
export const NO_CLASSES_MESSAGE: string;   // exact copy from Global Constraints
export const NOT_A_CALENDAR_MESSAGE: string;
export function previewHasNothing(p: GroupImportPreview): boolean; // matched, ambiguous and unmatched all empty
```

- **Rules:**
  - **Not a calendar:** `planGroupImport` throws `NotACalendarError` when the text has no `BEGIN:VCALENDAR` or `parseIcs` throws.
  - **Weighting:** each event weighs `expandOccurrences(ev).length`. Cancelled events are ignored.
  - **Skipped counters:** each one counts events, not occurrences.
  - **`unmatched`:** deduped by `(subjectName, label, reason)` and capped at 50.
  - **`subjectName`:** the DB subject name when matched, else `classifyEvent().subjectName`.
  - **`className`:** `classes.name`.
  - **`groupName`:** `class_groups.name`.
  - **Order of `matched`:** by subject name (`localeCompare` 'pl'), then by `CLASS_KINDS` index.
- **Apply:**
  - `applyGroupImport` keeps the pairs that are positive safe ints, slices to 100, validates them with one `class_groups` query (the group belongs to the class), and upserts in one transaction (`onDuplicateKeyUpdate set groupId`);
  - `skipped` = the input length − `set`.

- [ ] **Step 1: Write failing tests**
  - **Setup:**
    - `resetTestDb()`, then insert the subjects whose `unitime_name` equals the fixture SUMMARYs;
    - `Chemia ogólna (1rok)`: classes cwiczenia (groups 1–4), laboratorium (group 3), wyklad (group 1);
    - `Programowanie w języku Python (1rok)`: laboratorium (groups 1, 4);
    - `Algebra liniowa (1rok)`: cwiczenia only;
    - `Analiza matematyczna (1rok)`: cwiczenia (groups 1–4);
    - `Usunięty (1rok)`: cwiczenia (group 1), with the subject's `deleted_at` set;
    - a user.
  - **`plans the personal fixture`:**
    - `matched` has exactly the Chemia cwiczenia → group 2 (`CWA 2c` + `Ćwiczenia audytoryjne 2`), laboratorium → group 3 and wyklad → group 1, all with `currentGroupId: null`;
    - `ambiguous` has the Python laboratorium with groupNames `['Gr. 1','Gr. 4']` (or the stored names);
    - `unmatched` has the reasons `subject` (Nieznany), `class` (Algebra Projekt), `group` (Analiza CWA 9) and `subject` (Usunięty);
    - `skipped` is `{ exam: 1, noKind: 1, noGroup: 1 }`.
  - **`reports the current group`:** after `setMyGroup` sets Chemia cwiczenia to group 1, that entry has `currentGroupId` = group 1's id.
  - **`empty calendar`:** `personal-empty.ics` gives `totalEvents: 0`, and `previewHasNothing` is true.
  - **`not a calendar`:** `'<html>'` rejects with `NotACalendarError`.
  - **`apply merges`:**
    - the user has a group on Analiza cwiczenia;
    - `applyGroupImport` with the 3 matched pairs + `{classId: chemiaCw, groupId: pythonLabGroup1}` + `{classId: 1.5, groupId: 2}` gives `{ set: 3, skipped: 2 }`;
    - the Analiza row is unchanged.
  - **`apply caps at 100`:** 150 copies of one valid pair give `set ≤ 100`, with no throw.
- [ ] **Step 2:** Run `pnpm --filter @studies/db exec vitest run test/group-import.test.ts`. It must FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The test must PASS, then run `pnpm --filter @studies/db test` and `pnpm --filter @studies/db typecheck`.
- [ ] **Step 5:** Commit: `feat(db): plan and apply a My groups import from a UniTime calendar`.

### Task 3: Web import (simple and advanced My groups tab)

**Files:**
- Create: `apps/web/lib/group-import-actions.ts` (`'use server'`).
- Create: `apps/web/lib/group-import.ts`, with the pure helpers `readIcsFile(file: File | null): Promise<string | { error: string }>` and the module-level limiter `groupImportLimiter = createRateLimiter(6, 10 * 60_000)`.
- Create: `apps/web/components/plan/GroupImport.tsx` (client).
- Modify: `apps/web/components/plan/GroupsTab.tsx`, which renders `<GroupImport />` above `MyGroupsForm`.
- Test: `apps/web/test/group-import.test.ts` (vitest, mocking `requireUser`, the same way the existing action tests do; look at how `apps/web/test/` mocks `@/lib/session`).
- Test: `apps/web/e2e/group-import.spec.ts`.
- Copy `packages/db/test/fixtures/personal.ics` to `apps/web/e2e/fixtures/personal.ics`, and add to the e2e seed whatever subjects the e2e needs. Look at how the existing e2e specs seed (`apps/web/e2e/`), and keep it minimal: one subject `Chemia ogólna (1rok)` with a cwiczenia class and groups 1–2.

**Interfaces:**
- Consumes:
  - Task 1: `normalizeImportUrl`, `importAllowedHosts`, `fetchImportCalendar`, `SafeSyncError`, `IMPORT_MAX_BYTES`;
  - Task 2: `planGroupImport`, `applyGroupImport`, `NotACalendarError`, `NO_CLASSES_MESSAGE`, `NOT_A_CALENDAR_MESSAGE`, `previewHasNothing`, `GroupImportPreview`.
- Produces:
  - `previewGroupImportAction(form: FormData): Promise<{ ok: true; preview: GroupImportPreview; notice: string | null } | { ok: false; error: string }>`.
    - The FormData field is `url` (string) or `file` (File). The file wins when it is non-empty.
    - `notice` = `NO_CLASSES_MESSAGE` when `previewHasNothing` or `matched.length === 0 && ambiguous.length === 0`.
  - `applyGroupImportAction(pairs: unknown): Promise<{ ok: true; set: number } | { ok: false; error: string }>`.

- **Action rules:**
  - each action calls `requireUser()` first;
  - the preview runs the rate limiter, keyed by `String(user.id)`;
  - a `SafeSyncError` message passes through as is; any other error becomes `Could not read the calendar.`;
  - a `NotACalendarError` becomes `NOT_A_CALENDAR_MESSAGE`;
  - a file larger than `IMPORT_MAX_BYTES` gives `The file is too large (max 2 MB).`;
  - `applyGroupImportAction` checks that it got an array of at most 100 `{classId, groupId}` positive ints, else `{ ok: false, error: 'Invalid selection.' }`. Success then calls `revalidatePath` for `/plan` and `/s/plan`.
- **UI (`GroupImport.tsx`):**
  - **Shell:** a `<section aria-labelledby>` with the heading `Import from UniTime`.
  - **Help text:** `In UniTime open your personal timetable, choose Export → iCalendar and copy the link.`
  - **Inputs:**
    - a URL `<input type="url" name="url">` labelled `UniTime calendar link`;
    - a file input labelled `or upload a .ics file` (`accept=".ics,text/calendar"`);
    - the button `Preview`.
  - **Preview list:**
    - inside `role="status"`;
    - each matched line reads `<subject> · <class>: <group>`, plus ` (was <old>)` when the current group differs, or ` (already set)` when it is equal. The old name is resolved from the preview's data, else the text is `was another group`;
    - ambiguous lines read `<subject> · <class>: several groups (<names>), pick one below`;
    - `<details>` with the summary `N entries not matched`;
    - the skipped counts.
  - **Apply:** the button `Apply N groups` sends only the matched pairs whose `currentGroupId !== groupId`. If none differ, it shows the text `Your groups already match this calendar.` and no button. After success, it shows `Groups saved: N.` and calls `router.refresh()`.
  - **States:** errors go in `role="alert"`, using the existing `errBox` classes. Busy buttons use `aria-disabled` plus a ref guard, the same pattern as `EventUploads`.
  - **Style:** follow the existing `MyGroupsForm`/`RemindersForm` styling. Before writing UI, invoke the `minimalist-ui` and `redesign-existing-projects` skills, and keep to the existing design tokens.

- [ ] **Step 1: Write failing vitest cases**
  - unauthenticated → `requireUser` throws;
  - a bad url → the guard's error;
  - the 7th preview within 10 min → `Too many imports. Try again in a few minutes.`;
  - a file over 2 MiB → the size error;
  - an html file → `NOT_A_CALENDAR_MESSAGE`;
  - `applyGroupImportAction('x')`, and with 101 pairs → `Invalid selection.`;
  - a valid file → the preview, with no `url` key anywhere in the JSON result.
  - Use DB-backed setup if the existing web tests do, else mock `@studies/db` planning.
- [ ] **Step 2:** The tests FAIL.
- [ ] **Step 3:** Implement the actions and helpers.
- [ ] **Step 4:** The tests PASS. Implement the UI.
- [ ] **Step 5: Write the e2e** in `e2e/group-import.spec.ts`:
  - log in a student, open `/s/plan?tab=groups` (check the real tab param in `app/(simple)/s/plan/page.tsx`);
  - upload the fixture, click Preview, expect the text `Chemia ogólna` and the `Apply 1 groups` button (or whatever count your seed yields; assert the exact count);
  - click it, expect `Groups saved:`;
  - the cwiczenia `<select>` now shows group 2.
- [ ] **Step 6:** Run `pnpm --filter @studies/web exec vitest run test/group-import.test.ts`, `pnpm --filter @studies/web e2e e2e/group-import.spec.ts`, `pnpm --filter @studies/web typecheck`, `pnpm lint` and `pnpm check:lang`. All must pass.
- [ ] **Step 7:** Commit: `feat(web): import My groups from a UniTime calendar`.

### Task 4: Discord #panel import and docs

**Files:**
- Modify: `apps/bot/src/ui/ids.ts` (decode `groups:import` and `groups:importsubmit`), `apps/bot/src/ui/student.ts` (handlers), `apps/bot/src/ui/views/student.ts` (the `Import from UniTime` button in `groupsView`), `apps/bot/src/ui/views/modals.ts` (the import modal) and `apps/bot/src/ui/router.ts`. Modal submits for `stu` must route; check how the admin modals route.
- Create: `apps/bot/src/ui/group-import.ts`, holding the pure summary builder and the limiter `createRateLimiter`-style (copy the web's 40-line limiter into the bot; the apps share nothing but `@studies/db`, so alternatively move `createRateLimiter` into `packages/db/src/rate-limit.ts` and re-export it from web's `lib/rate-limit.ts`. **Prefer the move.**)
- Modify: `CLAUDE.md`. One sentence in the Bot specifics GUI paragraph: My groups can be imported from a personal UniTime iCal link (`packages/db/src/unitime/group-import.ts`; web My groups tab and the `#panel` modal; the link is never stored; `UNITIME_IMPORT_HOSTS`).
- Modify: `.env.example`. Add `# UNITIME_IMPORT_HOSTS=plan.agh.edu.pl` with a one-line comment.
- Test: `apps/bot/test/group-import.test.ts`.

**Interfaces:**
- Consumes: Task 1 and Task 2 exports; the existing `showGroups(ctx)` re-render; the existing banned-user gate in the student router.
- Produces: `groupImportSummary(preview: GroupImportPreview, result: { set: number }): string`.
  - Its first line is `Saved N groups.`;
  - then up to 15 lines `• <subject> · <class>: <group>`, then `…and K more`;
  - then `Several groups for M classes; pick them below.` when M>0;
  - then `K entries not matched.` when K>0;
  - or the whole text is `NO_CLASSES_MESSAGE` when nothing matched and nothing was ambiguous;
  - capped to the Discord text limit in `limits.ts`.
- **Behaviour:**
  - the button opens the modal;
  - the submit calls `deferReply` ephemeral, then rate-limits (key `discord:<userId>`), guards, fetches with `fetchImportCalendar`, plans and applies the pairs whose `currentGroupId !== groupId`;
  - it replies with the summary followed by the refreshed groups view (two messages, or summary text plus view, whichever the existing `ctx.show` supports);
  - errors use the same safe messages as the web;
  - it never logs the URL.

- [ ] **Step 1: Write failing tests**
  - `groupImportSummary`: 20 matched → 15 lines + `…and 5 more`; no matches → `NO_CLASSES_MESSAGE`.
  - id codec round-trip for both ids.
  - The submit handler with a fake fetch (follow how the existing student handler tests build `ctx`/deps):
    - it saves groups and replies with `Saved`;
    - a banned user is refused;
    - the 7th call → `Too many imports. Try again in a few minutes.`;
    - a bad host → the guard error, and the fake fetch is never called.
- [ ] **Step 2:** The tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter @studies/bot test`, `pnpm --filter @studies/bot typecheck`, `pnpm --filter @studies/web test` (if the limiter moved), `pnpm lint` and `pnpm check:lang`. All must pass.
- [ ] **Step 5:** Commit: `feat(bot): import My groups from a UniTime calendar in #panel`.

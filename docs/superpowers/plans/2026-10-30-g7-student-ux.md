# G7 Student UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close audit group G7 (U3–U8 and U12–U15 plus the QA lows in `docs/qa/2026-10-30/SUMMARY.md`). Students see today's classes and every upcoming event, every save confirms itself, races end on a helpful page instead of a bare 404, and the app meets the a11y and mobile basics.

**Architecture:**
- Page and query changes follow the existing pattern: thin pages, logic in `apps/web/lib/*.ts`, covered by vitest.
- New UI uses the existing design tokens and components. No new visual language; the curator found the system coherent.

**Tech Stack:** Next 16 App Router, React 19, Tailwind 4, Playwright.

**Spec:** `docs/qa/2026-10-30/SUMMARY.md` (U*), the persona reports in `docs/qa/2026-10-30/`, and `FINDINGS.md` (G7).

## Global Constraints

- UI strings English; content Polish, with `lang="pl"` on Polish content. `pnpm check:lang` must pass.
- Every page and Server Action calls `requireUser()`/`requireAdmin()` itself.
- Client components import only `@studies/db/constants` and `@studies/db/fields` (plus `import type`).
- Client-handled forms keep `method="post"`, enforced by `test/forms-method.test.ts`.
- UI work: load the `redesign-existing-projects` and `minimalist-ui` skills (Skill tool) before designing, and keep the existing tokens (`text-muted`, `border-line`, `bg-panel`…), radii and type scale.
- Test DB is shared: run one vitest file at a time. Commits as DBOYttt, unsigned, no trailers; never push.
- Read the relevant Next docs in `apps/web/node_modules/next/dist/docs/` before writing `not-found`, `metadata` or redirects.

## Review Focus

1. **"Today" on Start must use the student's My groups,** and fall back to all groups with the existing "Pick yours" hint when none are set. Timezone: Europe/Warsaw day bounds.
2. **Notices passed through redirects must not become an open redirect or an injection vector.** Use a fixed set of notice keys mapped to fixed strings, not free text from the URL.
3. **The friendly 404 must keep a 404 status** and must not leak whether a resource exists to someone who isn't allowed to see it.
4. **Focus management:** after closing a dialog, focus returns to the trigger. After a failed submit, focus moves to the first invalid field, and that field has `aria-invalid` plus `aria-describedby`.
5. **Tap-target changes must not break the desktop layout** (1440 px) or dark mode.

---

### Task 1: Helpful dead ends (U6, U7, chaos F5)

**Files:**
- Create:
  - `apps/web/app/not-found.tsx`, with nav back to Start and Timetable in the current mode and the app shell or a minimal branded frame;
  - a `(simple)` variant if the route groups need one; check how Next resolves `not-found` per segment.
- Modify:
  - the event delete flow: deleting an already-deleted event, by double click or a stale tab, redirects to the timetable with notice `event-deleted`, not a 404;
  - the upload POST to a deleted event returns a JSON error the client shows as "This event was deleted." instead of navigating to a 404;
  - `/login-info`: when reached because the session expired (proxy or `requireUser` redirect with `?expired=1`), show "Your session has ended. Sign in again with /link in Discord.";
  - the mode switch hydration mismatch after Back (chaos F3): investigate with superpowers:systematic-debugging and fix the root cause.
- Test:
  - vitest for the notice mapping and the delete action's already-deleted path;
  - e2e: double-click "Yes, delete" ends on the timetable with the notice;
  - e2e: an unknown route shows the branded 404 with a 404 status.

**Interfaces:**
- Produces:
  - `apps/web/lib/notices.ts` with `NOTICES: Record<NoticeKey, string>`, `noticeFromSearchParams(sp): string | null` (unknown keys → null) and `withNotice(path, key): string`;
  - `<Notice>`, a polite `role="status"` banner component, rendered by the pages that receive notices.

- [ ] **Step 1:** write the failing vitest and e2e tests.
- [ ] **Step 2:** implement.
- [ ] **Step 3:** run the touched vitest files one at a time, web typecheck, lint, check:lang, and the new e2e specs.
- [ ] **Step 4:** commit `feat(web): helpful 404, deleted-event and expired-session pages`.

### Task 2: Every save confirms itself (U5, U8, parked Remove feedback)

**Files:**
- Modify:
  - **Add/edit event (both modes):** after success, redirect to the event page with notice `event-saved`.
  - **My groups save and reminder toggles:** a visible status line next to the control, kept for at least 4 s and announced politely.
  - **Restore event:** notice `event-restored`.
  - **Admin "Remove" lecturer assignment:** the message shows in a card-level status area that survives the row unmounting.
  - **The two-tab My groups lost save (chaos F4):** reproduce with superpowers:systematic-debugging, fix the root cause, and add a regression test.
- Test:
  - vitest for the actions' redirect targets;
  - e2e: add event → event page shows "Event saved.";
  - e2e: groups save shows "Groups saved.".

- [ ] **Step 1:** write the tests (failing).
- [ ] **Step 2:** implement, reusing `notices.ts` from Task 1.
- [ ] **Step 3:** run the touched tests one at a time and the e2e specs, then web typecheck, lint, check:lang.
- [ ] **Step 4:** commit `feat(web): saves confirm themselves`.

### Task 3: Today and upcoming (U3, U4)

**Files:**
- Create:
  - `apps/web/lib/today.ts`: `todayForUser(db, userId, now)` returns today's class sessions (My groups, or all when none are set) and the next class if today has none, using Europe/Warsaw day bounds;
  - the events index pages `app/(simple)/s/wydarzenia/page.tsx` and `app/(app)/wydarzenia/page.tsx`, which list upcoming events (paginated, 25 per page, starting now) with the same rows as the Start card, plus an "Add event" button.
- Modify:
  - `/s` (Start) gains a "Today" card above Upcoming events: classes with time, room and kind; the next class when today is empty; a "Pick your groups" link when My groups is empty;
  - Upcoming events gets a "See all events" link to the index page;
  - the advanced timetable List view defaults to sessions from today (`starts_at >= today 00:00 Warsaw`) and keeps a "Show past" toggle;
  - the week view on narrow screens scrolls today's column into view on load.
- Test:
  - vitest for `todayForUser` (My groups filter, empty-groups fallback, Warsaw midnight bounds, next class);
  - vitest for the List default;
  - e2e: Start shows "Today", "See all events" opens the index, and the index lists the seeded upcoming events.

- [ ] **Step 1:** load the `redesign-existing-projects` and `minimalist-ui` skills and design the Today card and the index list inside the existing Start page system.
- [ ] **Step 2:** write the failing tests.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the tests one at a time and the e2e specs, then web typecheck, lint, check:lang.
- [ ] **Step 5:** commit `feat(web): today's classes on Start and an events index`.

### Task 4: Accessibility (U15 and a11y lows)

**Files:**
- Modify:
  - **Titles:** every page gets a distinct `<title>` via `metadata` or `generateMetadata`, in the form `<Page> · Studies DB`. Subject, event and lecturer pages use their name.
  - **Delete confirmation dialog** (find the component): Escape closes it, and focus returns to the trigger on Cancel or Escape.
  - **Forms:** server field errors render next to the field, with `aria-invalid="true"` and `aria-describedby`, and focus moves to the first invalid field.
    - Start with EventForm and the admin forms. ActionState may need an optional `field` key; keep the existing general alert for non-field errors.
  - **Light-mode muted text** reaches ≥ 4.5:1: adjust the `--muted`/`text-muted` token value only in light mode, checked against `bg-panel` and `bg-zebra`.
  - **The simple sidebar's subject names** get `lang="pl"`.
  - **Duplicate "Preview"/"Download" links** get accessible names that include the file name (`aria-label`).
  - **Add a favicon** (`app/icon.svg`, a simple glyph in the accent colour).
- Test:
  - vitest for the field error mapping;
  - e2e with keyboard: open delete, Escape → focus is on the Delete button;
  - submitting an empty-title event focuses Title, which has `aria-invalid`;
  - the titles of three pages are distinct.

- [ ] **Step 1:** write the failing tests.
- [ ] **Step 2:** implement.
- [ ] **Step 3:** run the tests one at a time and the e2e specs, then web typecheck, lint, check:lang.
- [ ] **Step 4:** commit `fix(web): page titles, dialog focus, field errors, contrast`.

### Task 5: Mobile and polish (U12, U13, U14, preview timeout)

**Files:**
- Modify:
  - **Tap targets:** at least 44 px on touch widths (below the `sm` breakpoint) for the top bar (Sign out, the Advanced/Simple switch, the menu button), the PDF viewer toolbar, event Edit/Delete, timetable Previous/Next, tabs and the Search button.
    - Use padding or min-height on small screens only, so the 1440 px layout is unchanged.
  - **Dark-mode date/time pickers:** `::-webkit-calendar-picker-indicator` is visible in dark mode, via `color-scheme: dark` on the inputs or a filter.
  - **Search counts (U13):** simple and advanced count files by the same rule (one shared function in lib).
    - Simple either shows topic hits or omits the topic count.
    - Fix the run-on text with a separator.
  - **Preview timeout:** `FilePreview`/`PdfViewer` show "Could not load the preview." with a Download link after 15 s without a first render or on load error.
- Test:
  - vitest for the shared search counting;
  - a unit test for the preview timeout with fake timers;
  - e2e at 375×812: the bounding boxes of the top bar controls are ≥ 44 px tall;
  - the 1440 px heights are unchanged for the same controls (assert ≤ the old height + 1).

- [ ] **Step 1:** load the `redesign-existing-projects` skill.
- [ ] **Step 2:** write the failing tests.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the tests one at a time and the e2e specs, then web typecheck, lint, check:lang.
- [ ] **Step 5:** add a "Fixed" note on G7 to `docs/audits/2026-10-30/FINDINGS.md`.
- [ ] **Step 6:** commit `fix(web): mobile tap targets, dark pickers, search counts, preview timeout`.

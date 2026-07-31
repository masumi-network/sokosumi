# Domain regression pattern details

Load **only** sections whose `Rn` was flagged via `QUALITY-TRIGGERS.md`. Severity / Medium PR notes live in `PHASE-REVIEWER.md`.

### R1 - Mutation order and atomicity

- **Investigator:** Map mutation order; flag partial-failure (orphan records, billing drift).
- **Tech Lead:** Spec appendix - **Mutation order** table (step, on failure / rollback, user-visible error).
- **Coder:** Dependent writes atomic or compensated; no success if later step failed.
- **Reviewer:** Failure-path in `/goal` (e.g. schedule fails → no stray task).

### R2 - Single source of truth for status

- **Investigator:** Allowed transitions; independent status writers.
- **Tech Lead:** Spec appendix - **State machine** table (user action → target status; derived vs explicit).
- **Coder:** One resolver for final status; never apply form toggle after API already set status.
- **Reviewer:** Matrix cases (draft + schedule, clear on QUEUED, toggle after schedule API).

### R3 - Idempotent updates

- **Investigator:** Unconditional re-PUT on unrelated edits.
- **Tech Lead:** When schedule/metadata is touched vs preserved.
- **Coder:** Skip schedule API when unchanged; preserve `nextRunAt` on metadata-only edits.
- **Reviewer:** Name-only edit on scheduled task → `nextRunAt` unchanged.

### R4 - Timezone and calendar semantics

- **Investigator:** Browser → web → Core; server TZ (often UTC on Vercel).
- **Tech Lead:** Spec appendix - **Time semantics** (display TZ, parse/persist TZ; cron vs UI label).
- **Coder:** Parse with schedule TZ; calendar days ≠ cron `*/N` day-of-month.
- **Reviewer:** Non-UTC boundary in manual checks when spec touches time.

### R6 - UI label ↔ API behavior

- **Investigator:** UI strings vs API/schema meaning.
- **Tech Lead:** Contract row per preset/column - **UI says** / **API does**.
- **Coder:** Do not client re-sort in a way that overrides API sort intent.
- **Reviewer:** Label matches behavior on happy path.

### R7 - Shared client state consistency

- **Investigator:** All surfaces reading/writing same state; race windows.
- **Tech Lead:** **State ownership** - provider vs page; mark-read, fetch, realtime rules.
- **Coder:** Consistent nav on mark-read failure; fetch must not stomp realtime.
- **Reviewer:** Two-surface check (badge + page, or toast + dropdown).

### R9 - Mobile and sheet/dialog lifecycle

- **Investigator:** `sm:` breakpoints; `SheetClose` + dialog state ownership.
- **Tech Lead:** **Responsive behavior** for &lt; `sm`; modal dismiss during async.
- **Coder:** No `SheetClose` wrapping stateful dialogs; mobile entry for critical nav.
- **Reviewer:** Narrow viewport or mobile screenshot when UI spec applies.

### R11 - Enum / status ripple effects

- **Investigator:** Grep archivable lists, transitions, UI actions, notification mappers, DnD.
- **Tech Lead:** Spec appendix - **Ripple checklist** (validators, UI, archive, notifications, columns).
- **Coder:** Update all consumers in same PR.
- **Reviewer:** No stale enum assumptions on touched status.

### R12 - Navigation targets and API response truth

- **Investigator:** Routes exist; lightweight vs heavy fetch patterns.
- **Tech Lead:** Real routes for links; response fields after sync.
- **Coder:** Response reflects post-sync state; 404 → `notFound()` not error page.
- **Reviewer:** Click-through on one deep link when notifications/links in scope.

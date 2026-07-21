# Bugbot learnings (Sapphire quality rules)

Distilled from high/medium Bugbot findings on `masumi-network/sokosumi`. Prevent regressions before Reviewer.

**Mandatory gates** (orchestrator after PR open — before Reviewer): CI green + Bugbot 0 High. See `SKILL.md` Phase 3. Do **not** post Bugbot to Linear — note Medium in PR body for human merge.

## Quality rules (R1–R12)

Apply when **trigger** matches. Investigator flags; Tech Lead encodes; Coder implements; Reviewer checks in `/goal`.

### R1 — Mutation order and atomicity

**Trigger:** Multi-step create/update (form → action → Core), billing + DB, schedule + status.

- **Investigator:** Map mutation order; flag partial-failure (orphan records, billing drift).
- **Tech Lead:** **Mutation order** table — step, rollback on failure, user-visible error.
- **Coder:** Dependent writes atomic or compensated; no success if later step failed.
- **Reviewer:** Failure-path in `/goal` (e.g. schedule fails → no stray task).

### R2 — Single source of truth for status

**Trigger:** Status enums, kanban, toggles, drag-and-drop, schedule-driven status.

- **Investigator:** Allowed transitions; independent status writers.
- **Tech Lead:** **State machine** table — user action → status; derived vs explicit.
- **Coder:** One resolver for final status; never apply form toggle after API already set status.
- **Reviewer:** Matrix cases (draft + schedule, clear on QUEUED, toggle after schedule API).

### R3 — Idempotent updates

**Trigger:** PUT/PATCH, schedule saves, notification upserts.

- **Investigator:** Unconditional re-PUT on unrelated edits.
- **Tech Lead:** When schedule/metadata is touched vs preserved.
- **Coder:** Skip schedule API when unchanged; preserve `nextRunAt` on metadata-only edits.
- **Reviewer:** Name-only edit on scheduled task → `nextRunAt` unchanged.

### R4 — Timezone and calendar semantics

**Trigger:** Date pickers, cron, `intervalDays`, `runAt`, recurring end dates.

- **Investigator:** Browser → web → Core; server TZ (often UTC on Vercel).
- **Tech Lead:** **Time semantics** — IANA TZ for display, parse, persist; cron vs UI label.
- **Coder:** Parse with schedule TZ; calendar days ≠ cron `*/N` day-of-month.
- **Reviewer:** Non-UTC boundary in manual checks when spec touches time.

### R5 — Serverless background work

**Trigger:** Notifications, emails, webhooks, post-response capture.

- **Investigator:** `void dispatch` without `waitUntil`; blocking `await` on non-critical path.
- **Tech Lead:** Side effects — must finish before response vs background (`waitUntil`).
- **Coder:** Core uses `waitUntil` for fire-and-forget; no bare `void` on serverless paths.
- **Reviewer:** Spec-listed background effects implemented correctly.

### R6 — UI label ↔ API behavior

**Trigger:** Presets, columns, badges, sort order, warning copy.

- **Investigator:** UI strings vs API/schema meaning.
- **Tech Lead:** Contract row per preset/column — **UI says** / **API does**.
- **Coder:** Do not client re-sort in a way that overrides API sort intent.
- **Reviewer:** Label matches behavior on happy path.

### R7 — Shared client state consistency

**Trigger:** Provider + page + toast + header; realtime + fetch.

- **Investigator:** All surfaces reading/writing same state; race windows.
- **Tech Lead:** **State ownership** — provider vs page; mark-read, fetch, realtime rules.
- **Coder:** Consistent nav on mark-read failure; fetch must not stomp realtime.
- **Reviewer:** Two-surface check (badge + page, or toast + dropdown).

### R8 — i18n key paths and locales

**Trigger:** `useTranslations`, `messages/*.json`, user-visible dates.

- **Investigator:** Namespace path matches component; locale file structure.
- **Tech Lead:** Translation namespaces in deliverables.
- **Coder:** Follow `translations` skill; no hardcoded relative times.
- **Reviewer:** Key path spot-check or non-`en` locale when UI-facing.

### R9 — Mobile and sheet/dialog lifecycle

**Trigger:** Sidebar, `Sheet`, modals, header nav.

- **Investigator:** `sm:` breakpoints; `SheetClose` + dialog state ownership.
- **Tech Lead:** **Responsive behavior** for &lt; `sm`; modal dismiss during async.
- **Coder:** No `SheetClose` wrapping stateful dialogs; mobile entry for critical nav.
- **Reviewer:** Narrow viewport or mobile screenshot when UI spec applies.

### R10 — Auth, workspace, and capability matrix

**Trigger:** New Core routes, coworker API keys, workspace-scoped lists.

- **Investigator:** Router flags (`includeWorkspaceContext`), capabilities, scope params.
- **Tech Lead:** **Auth matrix** — caller type × endpoint × capability/scope.
- **Coder:** Match sibling endpoints; parallel fetches handle 404 consistently.
- **Reviewer:** Wrong-workspace / missing-capability cases when in spec.

### R11 — Enum / status ripple effects

**Trigger:** New status, job status, notification kind.

- **Investigator:** Grep archivable lists, transitions, UI actions, notification mappers, DnD.
- **Tech Lead:** **Ripple checklist** — validators, UI, archive, notifications, columns.
- **Coder:** Update all consumers in same PR.
- **Reviewer:** No stale enum assumptions on touched status.

### R12 — Navigation targets and API response truth

**Trigger:** `href` builders, admin CRUD, POST responses after sync.

- **Investigator:** Routes exist; lightweight vs heavy fetch patterns.
- **Tech Lead:** Real routes for links; response fields after sync.
- **Coder:** Response reflects post-sync state; 404 → `notFound()` not error page.
- **Reviewer:** Click-through on one deep link when notifications/links in scope.

## Mandatory Bugbot (before Reviewer)

**Gate runner** (orchestrator in squad mode; standalone Coder when alone) runs **one Bugbot review** per PR before Reviewer. **Re-run** after Reviewer pushes — zero High before PR ready. Launch Task subagent — do not assume repo-local skill file:

| Field | Value |
|-------|-------|
| `subagent_type` | `bugbot` |
| `readonly` | `true` |
| `run_in_background` | `false` |
| `description` | `Bugbot` |

Prompt (exact shape):

```text
Full Repository Path: <absolute repository root>
Diff: branch changes
```

In Cursor IDE, `/review-bugbot` same flow when editor skill installed. If subagent cannot compute diff, retry once with `Diff: natural language` + per-file change description (see `review-bugbot` skill retry rules).

| Severity | Action |
|----------|--------|
| **High** | **Must fix** on PR branch. Re-run until **zero High**. |
| **Medium** | **Do not block** Reviewer. Note in **PR body** for human merge — not Linear. Fix in PR only if trivial and in scope. |
| **Low** | Optional note; no gate. |

### Medium findings — PR body only

When Bugbot reports ≥1 Medium, add short table to **PR description** (or PR comment). Do **not** post to Linear.

```markdown
### Bugbot medium (human review)

| Location | Finding |
|----------|---------|
| `path:line` | … |
```

Skip when no medium findings.

If Bugbot cannot run (subagent failure after retry), **stop before Reviewer** and report blocker.

## Coder self-check (before Bugbot)

Answer each triggered rule (R1–R12). Fix obvious gaps before open/update PR.

1. Multi-step writes — order + failure behavior defined and implemented?
2. Status — one resolver; no stale toggle after schedule/status API?
3. Updates — no blind re-PUT of unchanged schedule/metadata?
4. Time — TZ documented and used consistently?
5. Background — `waitUntil` where needed?
6. UI labels match API/cron/sort behavior?
7. Shared client state — races and cross-surface sync handled?
8. i18n keys under correct namespace in all touched locales?
9. Mobile/sheet/dialog flows tested mentally?
10. Auth/workspace/capability aligned with sibling routes?
11. New enums/status — all consumers updated?
12. Links and POST responses reflect real routes and post-sync state?

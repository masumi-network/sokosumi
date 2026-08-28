# Quality rules (R1–R12)

Distilled from high/medium Bugbot findings on `masumi-network/sokosumi`. Use during `/branch-bugbot-gate` and while implementing. Prefer fixing triggered risks before Bugbot runs.

Apply a rule only when its **trigger** matches the diff.

### R1 — Mutation order and atomicity

**Trigger:** Multi-step create/update (form → action → Core), billing + DB, schedule + status.

- Map write order; flag partial-failure (orphan records, billing drift).
- Dependent writes atomic or compensated; no success if a later step failed.

### R2 — Single source of truth for status

**Trigger:** Status enums, kanban, toggles, drag-and-drop, schedule-driven status.

- One resolver for final status; never apply a form toggle after an API already set status.
- Honor allowed transition tables on DnD and save.

### R3 — Idempotent updates

**Trigger:** PUT/PATCH, schedule saves, notification upserts.

- Skip schedule/metadata APIs when unchanged.
- Preserve `nextRunAt` / anchors on metadata-only edits.

### R4 — Timezone and calendar semantics

**Trigger:** Date pickers, cron, `intervalDays`, `runAt`, recurring end dates.

- Parse/persist with the schedule IANA TZ, not server host TZ (often UTC on Vercel).
- Calendar days ≠ cron `*/N` day-of-month; UI label must match API meaning.

### R5 — Serverless background work

**Trigger:** Notifications, emails, webhooks, post-response capture.

- Fire-and-forget on Core uses `waitUntil`, not bare `void`.
- Do not block email/critical path on non-essential awaits unless required.

### R6 — UI label ↔ API behavior

**Trigger:** Presets, columns, badges, sort order, warning copy.

- Contract: **UI says** / **API does**.
- Do not client re-sort in a way that overrides API sort intent.

### R7 — Shared client state consistency

**Trigger:** Provider + page + toast + header; realtime + fetch.

- One ownership story for mark-read, fetch, and realtime.
- Fetch must not stomp fresher realtime; loading must not hide existing data.
- Navigation on mark-read failure is consistent across surfaces.

### R8 — i18n key paths and locales

**Trigger:** `useTranslations`, `messages/*.json`, user-visible dates.

- Namespace path matches the component; same structure across touched locales.
- No hardcoded relative-time English strings.

### R9 — Mobile and sheet/dialog lifecycle

**Trigger:** Sidebar, `Sheet`, modals, header nav.

- No `SheetClose` wrapping stateful dialogs that must stay mounted.
- Critical nav has a mobile entry below `sm` when desktop-only would hide it.

### R10 — Auth, workspace, and capability matrix

**Trigger:** New Core routes, coworker API keys, workspace-scoped lists.

- Match sibling endpoints for `includeWorkspaceContext` and capabilities.
- List/search scope (`owned` vs `workspace`) matches the page the UI claims to mirror.
- Parallel page fetches handle 404 consistently (`notFound` vs error page).

### R11 — Enum / status ripple effects

**Trigger:** New status, job status, notification kind.

- Update validators, UI actions, archive lists, notification mappers, DnD, columns in the same change.

### R12 — Navigation targets and API response truth

**Trigger:** `href` builders, admin CRUD, POST responses after sync.

- Links point at real app routes.
- Response bodies reflect post-sync state (no hardcoded stale fields).

## Pre-Bugbot checklist

Answer for each triggered rule. Fix obvious gaps before launching Bugbot.

1. Multi-step writes — order and failure behavior correct?
2. Status — one resolver; no stale toggle after schedule/status API?
3. Updates — no blind re-PUT of unchanged schedule/metadata?
4. Time — TZ used consistently?
5. Background — `waitUntil` where needed?
6. UI labels match API/cron/sort behavior?
7. Shared client state — races and cross-surface sync handled?
8. i18n keys under correct namespace in touched locales?
9. Mobile/sheet/dialog flows sound?
10. Auth/workspace/capability aligned with sibling routes?
11. New enums/status — all consumers updated?
12. Links and POST responses reflect real routes and post-sync state?

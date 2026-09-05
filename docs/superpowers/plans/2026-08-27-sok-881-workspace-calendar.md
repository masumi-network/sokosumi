# SOK-881 Workspace Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a read-only Workspace Calendar that displays valid v1 and v2 schedules plus reconciled release history without requiring a global epoch migration.

**Architecture:** Core owns a bounded, cursor-paginated workspace Calendar API. It merges virtual schedule projections with persisted occurrence-ledger rows, preserving ledger source/time accuracy and treating a v1 occurrence identity as display-only. Web consumes that Core DTO through the generated client and renders source-aware month, week, and agenda views with URL-backed state.

**Tech Stack:** Hono, Prisma, Zod/OpenAPI, Vitest, Next.js, React, nuqs, date-fns, Tailwind.

**Spec:** Linear SOK-881 and revised SOK-880 rollout requirements.

## Global Constraints

- Calendar reads must project every valid active v1 or v2 schedule; epochs are not required for browse.
- Web only accesses Calendar data through the generated Core client.
- The API range is bounded, pagination has a deterministic merged sort key, and authorization prevents cross-workspace leakage.
- Persisted occurrence rows retain their captured source, source accuracy, and time accuracy.
- v1 projected occurrence identities are display-only; no Calendar mutation is exposed in this ticket.
- Reuse existing dependencies. Do not add FullCalendar or Temporal.
- All user-facing Web text has matching `en`, `de`, and `es` messages.

---

### Task 1: Project Calendar Occurrences In Core

**Files:**
- Modify: `apps/core/src/helpers/task-schedule.ts`
- Modify: `apps/core/src/helpers/task-schedule.test.ts`

**Interfaces:**
- Consumes: `TaskScheduleMetadata`, `computeScheduleNextRun()`, `isDueRunPastScheduleEnd()`.
- Produces: `projectTaskScheduleOccurrences(metadata, nextRunAt, from, to)` returning ordered `{ scheduledAt, originalScheduledAt, id }` display projections for valid v1/v2 schedules.

- [ ] **Step 1: Write failing projection tests**

Test one-time, recurring v1, recurring v2, after-N limits, interval schedules, and range exclusion. Assert v1 IDs are deterministic task/time display keys and v2 IDs include the persisted epoch UUID.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter core test src/helpers/task-schedule.test.ts`

Expected: FAIL because `projectTaskScheduleOccurrences` does not exist.

- [ ] **Step 3: Implement the bounded projector**

Advance from the persisted `nextRunAt`, clone only in-memory metadata while counting projected releases, stop at `to`, the schedule end, or a fixed projection cap, and return sorted projections. Do not write Tasks or occurrence rows.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter core test src/helpers/task-schedule.test.ts`

Expected: PASS.

### Task 2: Expose Workspace Calendar Reads

**Files:**
- Create: `apps/core/src/schemas/workspace-calendar.schema.ts`
- Create: `apps/core/src/routes/v1/workspaces/[id]/calendar/get.ts`
- Create: `apps/core/src/routes/v1/workspaces/[id]/calendar/get.test.ts`
- Modify: `apps/core/src/routes/v1/workspaces/index.ts`

**Interfaces:**
- Consumes: Task 1 projector, `validatePersistedTaskSchedule()`, `requireAuthorizedUserContext()`, standard Core response helpers.
- Produces: `GET /v1/workspaces/{id}/calendar?from&to&cursor&limit` returning Calendar items with source and accuracy metadata.

- [ ] **Step 1: Write failing route tests**

Cover personal and organization access, forbidden users, invalid/oversized ranges, v1/v2 schedule projection, ledger source fidelity, malformed/quarantined omission, deterministic mixed ordering, and cursor continuation.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter core test src/routes/v1/workspaces/[id]/calendar/get.test.ts`

Expected: FAIL because the route is not mounted.

- [ ] **Step 3: Implement the route and OpenAPI DTO**

Validate a maximum 90-day half-open range. Authorize the workspace with the existing workspace get-route pattern. Query eligible Task schedule templates and occurrence-ledger rows, project valid schedules, merge them by effective time plus stable ID, encode/decode that tuple as an opaque cursor, and return standard pagination metadata. Return source snapshots from ledger rows unchanged.

- [ ] **Step 4: Verify GREEN and regenerate the client**

Run: `pnpm --filter core test src/routes/v1/workspaces/[id]/calendar/get.test.ts`

Run: `pnpm --filter web generate:core:snapshot`

Expected: route tests pass and generated Calendar DTOs are updated without manual edits.

### Task 3: Render The Workspace Calendar In Web

**Files:**
- Create: `apps/web/src/app/(app)/calendar/page.tsx`
- Create: `apps/web/src/app/(app)/calendar/components/workspace-calendar.tsx`
- Create: `apps/web/src/app/(app)/calendar/components/workspace-calendar.test.tsx`
- Modify: `apps/web/src/lib/clients/core.shared.ts`
- Modify: `apps/web/src/lib/services/task.service.ts`
- Modify: `apps/web/src/app/(app)/components/sidebar/components/menu-items.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/de.json`
- Modify: `apps/web/messages/es.json`

**Interfaces:**
- Consumes: generated Task 2 client endpoint and URL state through `nuqs`.
- Produces: `/calendar` with source toggles, Coworker/status filters, month/week/agenda desktop views, month/agenda mobile views, and links to Tasks.

- [ ] **Step 1: Write failing UI/service tests**

Cover server data loading through Core, source/accuracy labels, URL-backed view/date/source/filter state, responsive view availability, loading/error states, and task navigation.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter web test src/app/(app)/calendar/components/workspace-calendar.test.tsx`

Expected: FAIL because the Calendar page and component do not exist.

- [ ] **Step 3: Implement the smallest dependency-free renderer**

Use date-fns and existing shadcn controls to render the three views. Month and week are responsive grids; agenda is an ordered accessible list. Keep filters and source visibility in `nuqs`, show explicit inferred/unknown and approximate labels, and link each item to its Task.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter web test src/app/(app)/calendar/components/workspace-calendar.test.tsx`

Run: `pnpm --filter web messages:parity`

Expected: UI tests and locale parity pass.

### Task 4: Verify The Vertical Slice

**Files:**
- Modify only files required by review fixes.

- [ ] **Step 1: Run focused API and UI proof**

Run: `pnpm --filter core test src/helpers/task-schedule.test.ts src/routes/v1/workspaces/[id]/calendar/get.test.ts`

Run: `pnpm --filter web test src/app/(app)/calendar/components/workspace-calendar.test.tsx`

- [ ] **Step 2: Run static gates**

Run: `pnpm check`

Run: `pnpm typecheck`

- [ ] **Step 3: Review the branch**

Inspect: `git diff --check` and the complete diff from `sok-879-dual-write-releases-and-reconcile-schedule-history`.

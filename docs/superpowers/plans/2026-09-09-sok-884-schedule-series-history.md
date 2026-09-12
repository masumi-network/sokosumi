# SOK-884 Schedule Series and Occurrence History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task by task, with a fresh implementer and independent reviewer for each task.

**Goal:** Make Task detail the safe management and history surface for an existing Calendar schedule series.

**Architecture:** Extend the existing Core schedule metadata, occurrence ledger, locking helpers, services, and Web Task-detail flow. Core owns all schedule reads and writes; Web consumes only the regenerated OpenAPI client. Mutations use one schedule revision across field edits, rule replacement, removal, and release.

**Tech Stack:** TypeScript, Hono/OpenAPI, Prisma, Next.js 16 App Router, React 19.2, next-intl, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-09-sok-884-schedule-series-history.md`

## Global constraints

- Work test-first: add the failing public-contract test, observe the expected failure, implement the narrowest behavior, and rerun focused tests.
- Reuse `Task.scheduleRevision`, schedule v2 metadata/epochs, `TaskScheduleOccurrence`, `TaskEvent.scheduleOperationId`, Calendar/Task locks, and existing Web schedule components/services.
- Do not add a migration, a second schedule model, silent compatibility reads/writes, or hand-edit generated Web client files.
- Keep `PUT /tasks/{id}/schedule` legacy-compatible; enforce the new envelope on `PUT /tasks/{id}/calendar-schedule`.
- Released Tasks are independent. Never cancel/archive released Tasks when their source series changes.
- Add stable error kinds in `@sokosumi/utils` and match them in Web without parsing messages.
- Use `apply_patch` for source edits, conventional commits, and the commands listed below.

## Task 1: Make the schedule revision the lifecycle concurrency token

**Files:**

- Modify: `packages/utils/src/core-api-error-kind.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/patch.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/patch.test.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/events/post.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/events/post.test.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/delete.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/delete.test.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/workspace/put.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/workspace/put.test.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/schedule/put.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/schedule/put.test.ts`
- Modify: `apps/core/src/routes/v1/projects/[id]/tasks/post.ts`
- Modify: `apps/core/src/routes/v1/projects/[id]/tasks/post.test.ts`
- Modify: `apps/core/src/routes/v1/projects/[id]/tasks/[taskId]/delete.ts`
- Modify: `apps/core/src/routes/v1/projects/[id]/tasks/[taskId]/delete.test.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/get.test.ts`
- Modify: `apps/core/src/routes/v1/tasks/scheduled/post.test.ts`
- Modify: `apps/core/src/helpers/task.ts`
- Modify: `apps/core/src/helpers/task.test.ts`
- Modify: `apps/core/src/services/task-schedules-sync.ts`
- Modify: `apps/core/src/services/task-schedules-sync.test.ts`

### Steps

- [ ] Add all three stable kinds (`schedule_active`, `schedule_revision_conflict`, and `schedule_cursor_stale`) to the shared Core/Web error-kind map.
- [ ] Add failing tests for stable `schedule_active` and `schedule_revision_conflict` kinds, requiring `expectedScheduleRevision` on active-series editable-field patches, checking the revision under the existing Calendar/Task locks, incrementing it atomically on success, and exposing the incremented value through mapped Task reads/responses.
- [ ] Add failing release tests proving every v2 release increments `scheduleRevision` and preserves the released occurrence association. Do not fabricate legacy v1 once history that violates the existing ledger invariant.
- [ ] Confirm scheduled creation starts at revision 0. Add failing legacy schedule PUT tests proving its existing bare body remains accepted while the write takes the existing locks and increments the revision.
- [ ] Add failing generic-mutation tests proving active-series status/cancel/archive and every Task/Project workspace or project move path returns 409 `schedule_active`.
- [ ] Add tests proving an inactive historical template can be archived even while a released Task runs, and generic cancel/archive never changes released Tasks.
- [ ] Implement the smallest guards and revision update in the existing routes/services. Delete the now-unused cascade helpers—including their running-child block—and behavior-specific tests; retain unrelated Task helpers.
- [ ] Run:
  `pnpm --filter @sokosumi/core test 'src/routes/v1/tasks/[id]/patch.test.ts' 'src/routes/v1/tasks/[id]/events/post.test.ts' 'src/routes/v1/tasks/[id]/delete.test.ts' 'src/routes/v1/tasks/[id]/workspace/put.test.ts' 'src/routes/v1/tasks/[id]/schedule/put.test.ts' 'src/routes/v1/projects/[id]/tasks/post.test.ts' 'src/routes/v1/projects/[id]/tasks/[taskId]/delete.test.ts' 'src/routes/v1/tasks/[id]/get.test.ts' src/routes/v1/tasks/scheduled/post.test.ts src/services/task-schedules-sync.test.ts src/helpers/task.test.ts`
- [ ] Run: `pnpm --filter @sokosumi/core typecheck`
- [ ] Commit: `feat(calendar): enforce schedule revision lifecycle`

## Task 2: Make full-series edit and removal revision-safe and idempotent

**Files:**

- Modify: `apps/core/src/schemas/task-schedule.schema.ts`
- Modify: `apps/core/src/schemas/task-schedule.schema.test.ts`
- Modify: `apps/core/src/helpers/task-schedule-occurrence-index.ts`
- Modify: `apps/core/src/helpers/task-schedule-occurrence-index.test.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/calendar-schedule/put.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/calendar-schedule/put.test.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/schedule/delete.ts`
- Modify: `apps/core/src/routes/v1/tasks/[id]/schedule/delete.test.ts`
- Modify: `apps/core/src/services/task-schedule-create.service.ts`
- Modify: `apps/core/src/services/task-schedule-create.service.test.ts`

### Steps

- [ ] Split the schema helpers so the legacy route can still extract a bare schedule, while the Calendar route accepts only `{ operationId, expectedScheduleRevision, discardFutureExceptions: true, schedule }`.
- [ ] Add a focused occurrence-index helper and failing tests that convert future skipped/moved planned exceptions to `CANCELED`, delete only ordinary future planned projections, and preserve released/past history. Replace the destructive helper at both series edit/removal call sites rather than leaving parallel cleanup paths.
- [ ] Add failing Calendar PUT route tests for revision mismatch, missing confirmation, exact idempotent replay, conflicting operation reuse, new epoch metadata, one revision increment, and durable-exception cancellation under existing locks.
- [ ] Reuse the scheduled-Task-create canonical SHA-256 fingerprint pattern. Store fingerprint plus Task identity in the unique operation event, emit stable `idempotency_conflict` for semantic reuse, and re-read/map the Task on exact replay; never persist a full API response in public `schedulePayload`.
- [ ] Add failing DELETE route tests for required UUID `Idempotency-Key`, exact `x-schedule-revision: {n}`, revision conflict, exact retry, conflicting reuse, Draft restoration from READY as well as QUEUED, metadata clearing, one revision increment, and history preservation.
- [ ] Require interactive human + Task collaboration for PUT and DELETE; keep Calendar PUT beta-gated but preserve DELETE as the non-beta escape hatch for legacy schedules. Task 3 applies interactive human + Task collaboration + Calendar beta access to occurrence reads.
- [ ] Implement both mutation paths in the existing routes/helpers and standard response/error envelopes.
- [ ] Run:
  `pnpm --filter @sokosumi/core test src/schemas/task-schedule.schema.test.ts src/helpers/task-schedule-occurrence-index.test.ts src/services/task-schedule-create.service.test.ts 'src/routes/v1/tasks/[id]/calendar-schedule/put.test.ts' 'src/routes/v1/tasks/[id]/schedule/delete.test.ts'`
- [ ] Run: `pnpm --filter @sokosumi/core typecheck`
- [ ] Commit: `feat(calendar): make series mutations idempotent`

## Task 3: Add the revision-safe occurrence history endpoint

**Files:**

- Create: `apps/core/src/routes/v1/tasks/[id]/schedule/occurrences/get.ts`
- Create: `apps/core/src/routes/v1/tasks/[id]/schedule/occurrences/get.test.ts`
- Create: `apps/core/src/schemas/task-schedule-occurrence.schema.ts`
- Create: `apps/core/src/schemas/task-schedule-occurrence.schema.test.ts`
- Modify: `apps/core/src/routes/v1/tasks/index.ts`

### Steps

- [ ] Define OpenAPI query/response schemas for `view=upcoming|history`, a capped cursor page, occurrence timing/state/epoch fields, source snapshot, and minimal released Task navigation.
- [ ] Add failing route tests for interactive-human authentication, Task collaboration, Calendar beta access, upcoming ascending order, history descending order, correct view membership (including past `PLANNED` rows as unreleased history), page boundaries, linked released Task data, and missing series/task responses.
- [ ] Encode an opaque cursor containing `view`, `scheduleRevision`, effective time, and occurrence id. Add a failing test proving a cursor from an earlier revision returns 409 `schedule_cursor_stale`.
- [ ] Implement the read with direct Prisma and keyset pagination. Do not use an interactive transaction for this GET.
- [ ] Mount the occurrence route beside the existing `/{id}/schedule/*` routes in `apps/core/src/routes/v1/tasks/index.ts`.
- [ ] Run:
  `pnpm --filter @sokosumi/core test src/schemas/task-schedule-occurrence.schema.test.ts 'src/routes/v1/tasks/[id]/schedule/occurrences/get.test.ts'`
- [ ] Run: `pnpm --filter @sokosumi/core typecheck`
- [ ] Commit: `feat(calendar): expose schedule occurrence history`

## Task 4: Render schedule series and paginated history on Task detail

**Required skill:** Read and apply `better-interface` before editing product UI; it may route to the narrower Jakub UI skills.

**Files:**

- Regenerate: `apps/web/src/lib/clients/generated/core/`
- Modify: `apps/web/src/lib/clients/core.shared.ts`
- Modify: `apps/web/src/lib/services/task-schedule.service.ts`
- Create: `apps/web/src/lib/services/task-schedule.service.test.ts`
- Modify: `apps/web/src/app/(app)/tasks/components/task-detail-view.tsx`
- Create: `apps/web/src/app/(app)/tasks/components/task-schedule-series.tsx`
- Create: `apps/web/src/app/(app)/tasks/components/task-schedule-series.test.tsx`
- Create: `apps/web/src/app/(app)/tasks/components/task-schedule-occurrences.tsx`
- Create: `apps/web/src/app/(app)/tasks/components/task-schedule-occurrences.test.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/de.json`
- Modify: `apps/web/messages/es.json`

### Steps

- [ ] Regenerate the Core OpenAPI snapshot/client from the completed Core endpoint; never edit generated artifacts by hand.
- [ ] Add service tests and implementation for first-page and cursor-page occurrence reads with stable error-kind propagation.
- [ ] Add failing component tests for Calendar/source identity, rule/timezone, next occurrence, inline future-exception markers, canceled history, released Task links, empty states, accessible tabs, and locale-safe dates. Do not add a separate exceptions region.
- [ ] Render initial pages in a Suspense-friendly server component. Keep only tab/load-more state in a small client component; use `key={scheduleRevision}` for revision resets rather than an effect.
- [ ] On `schedule_cursor_stale`, refresh the route and discard accumulated pages. Preserve `no-store` for user-scoped Core reads.
- [ ] Add equivalent English, German, and Spanish keys to the owning Task-detail client message bag.
- [ ] Run: `pnpm --filter web generate:core:snapshot`
- [ ] Run:
  `pnpm --filter web test src/lib/services/task-schedule.service.test.ts 'src/app/(app)/tasks/components/task-schedule-series.test.tsx' 'src/app/(app)/tasks/components/task-schedule-occurrences.test.tsx'`
- [ ] Run: `pnpm --filter web messages:parity && pnpm --filter web typecheck`
- [ ] Commit: `feat(calendar): show series history on task detail`

## Task 5: Wire revision-safe Task and Calendar series management

**Required skills:** Continue applying `better-interface`; apply `translations` for every message catalog change.

**Files:**

- Modify: `apps/web/src/lib/services/task.service.ts`
- Modify: `apps/web/src/lib/services/task.service.test.ts`
- Modify: `apps/web/src/lib/actions/task/action.ts`
- Modify: `apps/web/src/lib/actions/task/action.test.ts`
- Modify: `apps/web/src/app/(app)/tasks/components/task-form.tsx`
- Modify: `apps/web/src/app/(app)/tasks/components/task-form.test.tsx`
- Modify: `apps/web/src/app/(app)/tasks/components/task-schedule-modal.tsx`
- Modify: `apps/web/src/components/task-schedule-section.tsx`
- Modify: `apps/web/src/app/(app)/tasks/components/task-detail-actions.tsx`
- Modify: `apps/web/src/app/(app)/tasks/components/task-detail-actions.test.tsx`
- Modify: `apps/web/src/app/(app)/tasks/utils/task-read-only.ts`
- Modify: `apps/web/src/app/(app)/tasks/utils/task-read-only.test.ts`
- Modify: `apps/web/src/app/(app)/calendar/components/workspace-calendar.tsx`
- Modify: `apps/web/src/app/(app)/calendar/components/workspace-calendar.edit.test.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/de.json`
- Modify: `apps/web/messages/es.json`

### Steps

- [ ] Add failing service/action tests proving active-series field edits send `expectedScheduleRevision`, use the returned incremented revision for a following schedule change, keep one stable UUID operation ID per user attempt, and map stable conflict kinds.
- [ ] Add failing removal tests proving `Idempotency-Key` and exact `x-schedule-revision` headers are sent, retries reuse the same operation ID, and success refreshes Task/Calendar routes.
- [ ] Add failing UI tests for conditional future-exception confirmation, schedule-removal confirmation, disabled/hidden generic status/archive/source-move controls on active series, drag-status rejection without silent unscheduling, and actionable stale-revision feedback.
- [ ] Thread the observed revision through the existing `TaskForm` → `TaskScheduleModal` → `TaskScheduleSection` builder and Calendar editor. Reuse the existing confirmation dialog, source markers, and schedule display helpers; the new series display is separate from the existing rule builder, not a replacement editor.
- [ ] Preserve the stable operation ID across retryable failures and generate a new ID only for a new user operation.
- [ ] Add or update English, German, and Spanish copy with exact key parity and real translations.
- [ ] Run:
  `pnpm --filter web test src/lib/services/task.service.test.ts src/lib/actions/task/action.test.ts 'src/app/(app)/tasks/components/task-form.test.tsx' 'src/app/(app)/tasks/components/task-detail-actions.test.tsx' 'src/app/(app)/tasks/utils/task-read-only.test.ts' 'src/app/(app)/calendar/components/workspace-calendar.edit.test.tsx'`
- [ ] Run: `pnpm --filter web messages:parity && pnpm --filter web typecheck`
- [ ] Commit: `feat(calendar): manage series with revision safety`

## Final integration and review

- [ ] Run `pnpm check` and fix only task-related findings.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run the repository code-review workflow against `origin/main`, fix all in-scope findings, and repeat until clean.
- [ ] Launch with `verify-sokosumi`, sign in through its harness, and manually prove Task-detail schedule display, pagination, released Task navigation, series edit confirmation, and schedule removal.
- [ ] Push the issue branch and open a draft PR titled from the primary Conventional Commit subject, linked to SOK-884 with verification evidence and UI screenshots.

# SOK-885 Reschedule One Occurrence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` to implement this plan task by task, with a fresh implementer and independent reviewer for each task.

**Goal:** Move one unreleased occurrence of a recurring Task schedule series to a new strictly-future time, idempotently and revision-safely, with the release engine honouring the move.

**Architecture:** Extend the SOK-884 occurrence ledger, locks, revision token, and TaskEvent audit. Make the v2 release path read its `nextRunAt` and release targets from the ledger instead of the rule walk, so a moved occurrence releases at its new time and a skipped one never releases.

**Tech Stack:** TypeScript, Hono/OpenAPI, Prisma, Next.js 16 App Router, React 19, next-intl, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-sok-885-reschedule-one-occurrence.md`

## Global constraints

- Work test-first: add the failing public-contract test, observe the failure, implement the narrowest behaviour, rerun focused tests.
- Reuse `Task.scheduleRevision`, schedule v2 metadata/epochs, `TaskScheduleOccurrence`, `TaskEvent.scheduleOperationId`, Calendar/Task locks, and the `schedule_operation` helpers.
- Do not add a migration, table, enum value, or alternate scheduler. `TaskScheduleEventKind.OCCURRENCE_RESCHEDULED` already exists.
- Legacy v1 release behaviour must not change.
- Add stable error kinds in `@sokosumi/utils` and match them in Web without parsing messages.
- Never hand-edit generated Web client files; regenerate after the Core contract lands.

## Task 1: Ledger-driven releaseable next-run for v2

**Files:**

- Modify: `apps/core/src/helpers/task-schedule-occurrence-index.ts`
- Modify: `apps/core/src/helpers/task-schedule-occurrence-index.test.ts`
- Modify: `packages/utils/src/core-api-error-kind.ts`

### Steps

- [ ] Add `schedule_occurrence_not_reschedulable` and `schedule_occurrence_target_invalid` to the shared Core/Web error-kind map.
- [ ] Add a helper `findNextReleaseableOccurrence(tx, seriesTaskId, now)` returning the earliest `PLANNED` row with `effectiveScheduledAt >= now` (excluding `SKIPPED`/`CANCELED`/`RELEASED`), with failing tests for moved, skipped, and exhausted ledgers.
- [ ] Add failing tests proving a projection refresh preserves moved/skipped rows and only replaces ordinary unmoved `PLANNED` projections for v2.
- [ ] Implement the smallest change to `refreshTaskSchedulePlannedOccurrences` / `replaceTaskSchedulePlannedOccurrences` to preserve durable exceptions.
- [ ] Commit: `feat(calendar): schedule release from the occurrence ledger`

## Task 2: Separate the v2 wake time from the rule anchor, and release from the ledger

**Files:**

- Modify: `apps/core/src/helpers/task-schedule.ts`
- Modify: `apps/core/src/helpers/task-schedule.test.ts`
- Modify: `apps/core/src/helpers/task-schedule-occurrence-index.ts`
- Modify: `apps/core/src/helpers/task-schedule-occurrence-index.test.ts`
- Modify: `apps/core/src/services/task-schedules-sync.ts`
- Modify: `apps/core/src/services/task-schedules-sync.test.ts`

### Steps

- [ ] Add a helper resolving the v2 rule anchor (`lastProcessedSourceAt ?? ruleEffectiveFrom`) and its next rule occurrence; failing tests cover unset, advanced, and ended anchors.
- [ ] Change the v2 projection to iterate from the rule anchor instead of `nextRunAt`, while `nextRunAt` becomes the earliest releaseable effective time; failing tests prove a moved row does not skip the rule occurrences between its original and moved times.
- [ ] Add failing sync tests: a moved `PLANNED` row releases at its `effectiveScheduledAt`; a `SKIPPED`/`CANCELED` row never releases; `lastProcessedSourceAt` advances to the released row's `originalScheduledAt`; `nextRunAt` becomes the next releaseable effective time; legacy v1 still walks the rule.
- [ ] Implement the v2 branch: claim due `PLANNED` rows, clone at each row's effective time (recording original + effective on the RELEASED row), advance the anchor and `epochReleaseCount`, and set `nextRunAt` from the ledger. Keep the v1 rule-walk untouched.
- [ ] Run `pnpm --filter @sokosumi/core test src/helpers/task-schedule.test.ts src/helpers/task-schedule-occurrence-index.test.ts src/services/task-schedules-sync.test.ts`.
- [ ] Run `pnpm --filter @sokosumi/core typecheck`.
- [ ] Commit: `feat(calendar): release v2 occurrences from the ledger`

## Task 3: Reschedule-one-occurrence contract

**Files:**

- Create: `apps/core/src/routes/v1/tasks/[id]/schedule/occurrences/patch.ts`
- Create: `apps/core/src/routes/v1/tasks/[id]/schedule/occurrences/patch.test.ts`
- Modify: `apps/core/src/routes/v1/tasks/index.ts`
- Create: `apps/core/src/schemas/task-schedule-occurrence-reschedule.schema.ts`
- Create: `apps/core/src/schemas/task-schedule-occurrence-reschedule.schema.test.ts`

### Steps

- [ ] Define the OpenAPI request (`operationId`, `expectedScheduleRevision`, `scheduledAt`) and response (`scheduleRevision`, `occurrence`).
- [ ] Add failing route tests for: interactive human + collaboration + beta gate, ownership/missing occurrence, non-`PLANNED`/due/released rejection (`409 schedule_occurrence_not_reschedulable`), target not strictly future or outside the horizon (`422`), same-time no-op, revision conflict (`409 schedule_revision_conflict`), exact idempotent replay, conflicting identity reuse (`409 idempotency_conflict`), one revision bump, `effectiveScheduledAt` changed while `originalScheduledAt`/epoch identity stay, audit TaskEvent `OCCURRENCE_RESCHEDULED`, and recomputed `nextRunAt`.
- [ ] Implement under `lockCalendarScope` → `lockTaskRows`, reusing `createTaskScheduleRequestFingerprint` and `isTaskScheduleOperationReplay`.
- [ ] Mount the route beside the occurrence GET in `apps/core/src/routes/v1/tasks/index.ts`.
- [ ] Run `pnpm --filter @sokosumi/core test src/schemas/task-schedule-occurrence-reschedule.schema.test.ts 'src/routes/v1/tasks/[id]/schedule/occurrences/patch.test.ts'`.
- [ ] Run `pnpm --filter @sokosumi/core typecheck`.
- [ ] Commit: `feat(calendar): reschedule one occurrence`

## Task 4: Regenerate the Web Core client

**Files:**

- Regenerate: `apps/web/src/lib/clients/generated/core/`
- Modify: `apps/web/src/lib/clients/core.shared.ts`
- Modify: `apps/web/src/lib/services/task-schedule.service.ts`
- Modify: `apps/web/src/lib/services/task-schedule.service.test.ts`

### Steps

- [ ] Run `pnpm --filter web generate:core:snapshot`.
- [ ] Add a service method `rescheduleOccurrence(taskId, occurrenceId, precondition, scheduledAt)` and focused tests, including stable-kind propagation.
- [ ] Run `pnpm --filter web typecheck`.
- [ ] Commit: `feat(calendar): wire occurrence reschedule to web`

## Task 5 (layer C): Calendar drag and explicit move UI

**Files:**

- Modify: `apps/web/src/app/(app)/calendar/components/workspace-calendar.tsx`
- Modify: `apps/web/src/app/(app)/calendar/components/workspace-calendar.edit.test.tsx`
- Modify: `apps/web/src/app/(app)/tasks/components/task-schedule-occurrences.tsx`
- Modify: `apps/web/src/app/(app)/tasks/components/task-schedule-occurrences.test.tsx`
- Modify: `apps/web/messages/en.json`, `de.json`, `es.json`

### Steps

- [ ] Make only occurrence events draggable; wire `eventDrop` to the reschedule contract with the observed revision and a stable operation id, with optimistic rollback on every stable kind.
- [ ] Add a keyboard/mobile "Move occurrence" action on the Calendar event and the Task-detail Upcoming row using the existing date/time picker.
- [ ] Refresh on `schedule_revision_conflict` / `schedule_cursor_stale`.
- [ ] Add en/de/es copy with exact key parity.
- [ ] Run `pnpm --filter web messages:parity && pnpm --filter web typecheck` and the affected component tests.
- [ ] Commit: `feat(calendar): drag and move one occurrence`

## Final integration and review

- [ ] `pnpm check`, `pnpm typecheck`, affected suites.
- [ ] Repository code review against the stack base; fix in-scope findings.
- [ ] Browser proof on the PR preview: drag an occurrence, confirm it moves and releases at the new time, and that a second move keeps identity.

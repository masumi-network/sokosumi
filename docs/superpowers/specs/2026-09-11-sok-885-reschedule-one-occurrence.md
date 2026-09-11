# SOK-885 Reschedule One Occurrence Design

## Goal

Let a human with Task collaboration and Calendar beta access move one unreleased occurrence of a recurring series to a new strictly-future time without changing the series rule, the occurrence's identity, or any released/canceled history. The move is revision-safe, idempotent, and the release engine releases the occurrence at its new time instead of its original.

## Scope

- Core: `PATCH /v1/tasks/{id}/schedule/occurrences/{occurrenceId}` taking `{ operationId, expectedScheduleRevision, scheduledAt }`.
- Durable planned-exception semantics: the first move keeps `originalScheduledAt` and updates `effectiveScheduledAt`; a moved occurrence can move again without changing identity.
- Scheduler: for v2/epoch-backed series, the ledger is the source of truth for release scheduling; a projection refresh must not delete durable exceptions.
- Web (layer C): month/week drag plus keyboard/mobile explicit actions with optimistic rollback.
- All new copy in English, German, and Spanish.

This extends the SOK-884 occurrence ledger, revision token, locks, and audit pattern. It adds no table, migration, enum value, or alternate scheduler. `TaskScheduleEventKind.OCCURRENCE_RESCHEDULED` already exists, so no schema change is required.

## Out of scope

- Skip and restore one occurrence (SOK-886).
- Dragging/moving a whole series between Calendar sources (SOK-887).
- Shortcut/default schedule authoring (SOK-888/889).
- Dropping the legacy scheduling contract (SOK-891).
- Editing an occurrence of a `once`/legacy schedule: rescheduling targets a projected occurrence of a recurring v2/Calendar-beta series only.

## Core contract

### Route

`PATCH /v1/tasks/{id}/schedule/occurrences/{occurrenceId}`

Body:

```json
{
  "operationId": "uuid",
  "expectedScheduleRevision": 3,
  "scheduledAt": "2026-09-20T09:00:00.000Z"
}
```

- `scheduledAt` is an absolute UTC instant. The web derives it from the chosen wall-clock time in the rule's timezone using the shared canonical DST helper (`zonedDateTimeLocalToUtc`); Core never re-interprets a wall time, so gap/overlap behaviour matches projection, next-run, and release.
- Auth: interactive human, Task collaboration, and the Calendar beta gate. Unlike series removal, reschedule is a management contract and stays beta-gated.

### Semantics

1. Lock the Calendar scope, then the Task rows (`lockCalendarScope` → `lockTaskRows`).
2. Re-read the Task and the occurrence under the locks so a concurrent release/rule change cannot slip past.
3. The occurrence must belong to the series, be `PLANNED`, unreleased, and not due (`effectiveScheduledAt > now`). Otherwise `409` with stable kind `schedule_occurrence_not_reschedulable`.
4. The target must be strictly future (`scheduledAt > now`) and inside the projection horizon (`< now + CALENDAR_OCCURRENCE_HORIZON_MS`), so the projector keeps owning the row. Otherwise `422`.
5. If `scheduledAt` equals the current `effectiveScheduledAt`, return the current state unchanged: no write, no revision bump, no event.
6. Otherwise update only `effectiveScheduledAt` (never `originalScheduledAt` or the epoch), increment `Task.scheduleRevision` once, recompute `Task.nextRunAt` from the ledger's releaseable rows, and write an `OCCURRENCE_RESCHEDULED` TaskEvent carrying the canonical request fingerprint and the occurrence identity, mirroring the SOK-884 audit pattern.
7. Idempotent replay: an exact `operationId` replay (same fingerprint) re-reads and returns the current occurrence; reusing the identity for different semantics returns `409` `idempotency_conflict`.
8. Response: `{ scheduleRevision, occurrence }` so the client can refresh its precondition without a second read.

New stable error kinds (shared `@sokosumi/utils` map): `schedule_occurrence_not_reschedulable`, `schedule_occurrence_target_invalid`.

### Scheduler integration

For v2/epoch-backed series (Calendar beta), release scheduling is ledger-driven:

- `Task.nextRunAt` is the earliest **releaseable** effective time in the active epoch: `state = PLANNED` and `effectiveScheduledAt >= now`, excluding `SKIPPED`, `CANCELED`, and `RELEASED`. A moved occurrence therefore pulls `nextRunAt` to its new time; a skipped one is invisible to release.
- When `nextRunAt <= now`, the release loop releases each due `PLANNED` row at the row's own `effectiveScheduledAt` (not the rule's projected time), marks it `RELEASED` with its cloned Task, then advances `nextRunAt` to the next releaseable row. `SKIPPED`/`CANCELED` rows are never released.
- `refreshTaskSchedulePlannedOccurrences` must stop clobbering durable exceptions: for v2 it deletes only ordinary projections (unmoved `PLANNED`, `original == effective`) and upserts the projected horizon, preserving moved and skipped rows. Rule edits/removal (SOK-884) already retire the old epoch's future half before reprojecting.
- Legacy v1 schedules keep the existing `nextRunAt` + rule-walk release path unchanged.

This makes the ledger authoritative for when v2 series release, which is the structural change SOK-879/880 anticipated.

## Web experience (layer C)

- Calendar month/week: projected occurrence events become draggable (`eventStartEditable` for occurrence events only); a drop calls the reschedule contract with the observed `scheduleRevision` and a stable browser-minted operation id. Move is optimistic; any 4xx rolls back and maps the stable kind to copy.
- Keyboard/mobile: an explicit "Move occurrence" action on the Calendar event and on the Task-detail Upcoming row opens the existing date/time picker and calls the same contract.
- On `schedule_revision_conflict` or `schedule_cursor_stale` the client refreshes the route and re-derives its precondition.
- Task detail already renders the moved time with its original ("moved from …") from SOK-884; no new ledger read is needed.

## Verification

- Core route tests: revision conflict, idempotent replay, identity preserved across repeated moves, strictly-future and horizon validation, `PLANNED`-only/due/released rejection, locks and authorization.
- Scheduler tests: release at the effective time, never release skipped/canceled, `nextRunAt` recomputed after a move, projection preserves durable exceptions, legacy v1 path unchanged.
- DST tests reuse the canonical helper so a moved occurrence in a DST gap/overlap resolves identically to projection and next-run.
- Web (layer C): drag and keyboard actions call the contract with the observed revision and a stable operation id; optimistic rollback on each stable kind.
- `pnpm check`, Core + Web typechecks, locale parity.

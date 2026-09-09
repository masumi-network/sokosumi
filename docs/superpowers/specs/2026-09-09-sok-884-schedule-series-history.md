# SOK-884 Schedule Series and Occurrence History Design

## Goal

Make Task detail the canonical home for an existing Calendar schedule series. A human with access to the Task can inspect the series and its occurrence ledger, edit or remove the full series safely, and navigate to released Tasks without changing their lifecycle.

## Scope

- Show the Calendar source, recurrence rule and timezone, next occurrence, future exceptions, canceled history, and released Tasks on Task detail.
- Add a revision-safe, cursor-paginated Core occurrence endpoint with `upcoming` and `history` views.
- Make full-series edits and removals optimistic, idempotent, and durable.
- Serialize active-series Task field edits with the same schedule revision used by release.
- Reject generic status, cancel, archive, and workspace-move paths while a series is active.
- Preserve released Tasks as independent records; series changes never cascade into them.

This work extends the existing Task schedule metadata and `TaskScheduleOccurrence` ledger. It adds no table, migration, alternate scheduler, or duplicate schedule model. The legacy schedule endpoint remains body-compatible until SOK-891, but every legacy rule write still takes the Calendar/Task locks and increments `scheduleRevision`. The Calendar full-series endpoint is the revision-safe management contract.

Core and Web ship this issue as one coordinated release. The PR updates every first-party caller in the same final branch before the stricter Calendar PUT and schedule DELETE contracts can reach production.

## Core contract

### Occurrence list

`GET /v1/tasks/{seriesTaskId}/schedule/occurrences`

Query:

- `view=upcoming|history`
- `limit`, default 20 and capped at 100
- opaque `cursor`

The cursor records the view, the observed `scheduleRevision`, and the occurrence ordering key. Reusing a cursor after the series revision changes returns HTTP 409 with stable kind `schedule_cursor_stale`; the Web client discards its accumulated pages and reloads the first page.

`upcoming` is ordered by effective run time ascending and includes future planned/skipped occurrences inside the existing 90-day projection horizon. `history` is ordered by effective run time descending and includes released/canceled occurrences and past skipped occurrences. Each item includes its ledger identity/state, original/effective time, timezone, epoch/revision context, source snapshot, and a minimal linked released Task when one exists. The Task's canonical `nextRunAt` supplies the next-occurrence summary; the paginated ledger is a bounded inspection index, not an infinite expansion.

### Full-series edit

`PUT /v1/tasks/{id}/calendar-schedule` requires:

```json
{
  "operationId": "uuid",
  "expectedScheduleRevision": 3,
  "discardFutureExceptions": true,
  "schedule": { "mode": "recurring", "expr": "0 9 * * *", "timezone": "Europe/Berlin" }
}
```

The mutation locks the Calendar scope and Task, verifies the expected revision, detects an exact `operationId` replay, always starts a new rule epoch (including when the submitted rule matches the current rule), increments the schedule revision once, cancels durable future exceptions, and regenerates ordinary projections. The audit event stores a canonical request fingerprint and Task identity, following the existing scheduled-Task-create pattern; replay re-reads and re-serializes the current Task rather than storing a full response in public event payload. Reusing an operation ID for different semantics returns stable kind `idempotency_conflict`.

### Series removal

`DELETE /v1/tasks/{id}/schedule` requires UUID header `Idempotency-Key` and `If-Match: "schedule-revision:{n}"`. The parent-series contract deliberately uses headers because DELETE has no request body and the precondition belongs in standard request metadata; the generated client supports typed header options after regeneration. It verifies revision under the same locks, cancels durable future exceptions, removes ordinary future projections, clears schedule metadata, returns an active Draft/Ready/Queued template to Draft, increments revision, and preserves all historical/released records. An exact retry returns the re-read serialized Task.

Durable future exceptions are skipped occurrences and moved planned occurrences whose effective time differs from their original time. Ordinary generated planned projections may be deleted and rebuilt.

### Other Task mutations

- Active-series name, description, and assignee edits require `expectedScheduleRevision`, lock with release, and increment the revision.
- Active-series project/workspace movement through every Task or Project move path is rejected with `schedule_active`; moving schedule sources belongs to SOK-887.
- Generic status/cancel/archive paths reject an active series with `schedule_active`.
- No generic or schedule mutation cancels or archives previously released Tasks.
- Once a template has no active schedule, even a running released Task does not block archiving that historical template; the released Task remains visible and unchanged.
- Revision mismatches use stable `schedule_revision_conflict`; no client matches human-readable messages.

Occurrence reads and full-series edits require an interactive human, Task collaboration access, and the existing Calendar beta-access gate. Schedule removal requires an interactive human and Task collaboration access but deliberately remains available outside the beta as an escape hatch for schedules created by the legacy un-gated endpoint.

## Web experience

Task detail gains a server-rendered Schedule section with Calendar/source identity, rule/timezone, next occurrence, and initial upcoming/history pages. A small client island owns tabs and “load more”; stale-cursor responses refresh the route and reset pages via the new revision prop. Future exceptions are distinguished inline in Upcoming rather than duplicated into a separate empty region.

Future exceptions and canceled history are visibly distinguished. Released occurrences link to their independent Task detail pages. Existing Task edit and Calendar edit surfaces pass a stable operation ID and observed revision. Editing asks for future-exception confirmation only when the endpoint reports an actual exception count. Removing a schedule uses a confirmation dialog and the revision-safe DELETE contract. Generic status/archive/move controls are unavailable for active series, and dragging a scheduled Task to another status is rejected rather than silently clearing its schedule, while Core remains authoritative.

All new user-facing copy is translated in English, German, and Spanish. Dates use next-intl formatters and the existing semantic color/UI primitives in light and dark themes.

## Out of scope

- Editing a single occurrence (SOK-885).
- Dragging an occurrence (SOK-886).
- Moving a series between Calendar sources (SOK-887).
- Shortcut/default schedule authoring (SOK-888/889).
- Dropping the legacy scheduling contract (SOK-891).

## Verification

- Focused Core route/helper/service tests prove revisions, locks, idempotent replay, durable exception cancellation, pagination, stale cursors, and non-cascading released Tasks.
- Focused Web service/action/component tests prove rendered schedule information, released Task navigation, pagination reload, and revision-safe edit/removal calls.
- Core and Web typechecks, locale parity, repository checks, and affected tests pass.
- Manual browser proof covers the Task-detail Schedule section, both occurrence tabs, load-more behavior, edit confirmation, and removal confirmation.

# ADR 0040: Recurring rules move from Task into Task Schedule

- Status: Accepted
- Date: 2026-09-23

A repeating rule is a **Task Schedule**, its own model, not a Task. It holds the rule and the blueprint (name, description, project, visibility, any assignee kind) and is Active, Paused, or Ended. Each Run creates a new Ready Task carrying `scheduleId`. A Task itself keeps only a single **Run at**; it never repeats. The API lives at `/v1/tasks/schedules`; the old per-Task schedule routes and `POST /v1/tasks/scheduled` answer `410 task_schedule_moved`.

**Why:** the template Task pretended to be work. Its rule lived as untyped JSON in `Task.metadata` (two versions, no backfill), so Core needed a quarantine for rules that went bad, Task statuses carried schedule exceptions (Queued needs a schedule, a live series owns the lifecycle), workspace move, project changes, and archive all had to refuse live series, and templates sat on the board as backlog Tasks. The template-plus-clone release also dropped Soko Bot and person assignees, and person-assigned series never released at all. A separate model makes the rule typed and the Task plain.

## Considered options

- **Keep the template Task, tidy the JSON into columns** — rejected. The status exceptions, the guards, and the board noise all stem from the rule living on a Task.
- **Keep the old routes as adapters for a deprecation window** — rejected. The only external callers are Coworker vendors; a 410 with a pointer plus the updated vendor doc is clearer than two parallel APIs.
- **Expand/contract across two deploys** — rejected in favour of one deploy. Accepted cost: once the old columns are dropped, rollback means restoring the pre-migration database snapshot.

## Consequences

- ADR 0029's "Queued needs a schedule" becomes "Queued needs a Run at"; a Task no longer has a live series lifecycle.
- Migration: healthy recurring series become Active schedules; quarantined series and person-assigned series that never released become Paused; one-time schedules become a Run at on the same Task; template Tasks are archived; `SCHEDULE` links become `scheduleId`, and the link type is dropped.
- Deleting a schedule sets `scheduleId` to null on the Tasks it created. Closing or deleting a project Ends its schedules.
- A skipped or moved Run is recorded on its Run row (state, moved time, and the person or Coworker who last changed it), not as a Task event or in a separate history table; a skip that was later restored leaves no trace.
- Task Schedules are not behind the Calendar beta; only the calendar view is.
- `SokoBotSchedule` is unrelated and stays separate.

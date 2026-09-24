# ADR 0029: Core computes selectable Task statuses per actor

- Status: Accepted; schedule rules amended by [ADR 0041](0041-recurring-rules-move-to-task-schedule.md)
- Date: 2026-09-15

The Task DTO carries `selectableStatuses`: the statuses the requesting actor may move that Task to right now, computed by Core from the Task's status, assignee, and schedule plus the actor kind. The same function gates `POST /v1/tasks/{id}/events` for non-agent actors, so a person can only set a status the picker would have offered. Web keeps no status rules of its own beyond the reopen-comment prompt, which shapes the UI before the request and is enforced in Core as well.

**Why:** the web mirrored four Core rules (hidden statuses, agent-only statuses, Queued needs a schedule, live series owns the lifecycle) and drifted; the sidebar offered Queued that the action then refused. Making Input required and Approval required coworker-only added a fifth rule. One Core function that both renders and rejects removes the drift.

## Considered options

- **Separate `GET /v1/tasks/{id}/status-options` route** — rejected. One more round trip on every detail open, and the Task DTO is already access-scoped per actor, so an actor-dependent field costs nothing new.
- **Keep the rules in `@sokosumi/utils` and call them from both apps** — rejected. Shared predicates still leave the composition (which rules apply, in which order, for which actor) duplicated in web.

## Consequences

- `Task` responses differ per actor. Do not cache a mapped Task across actors.
- The create form has no Task yet and keeps its static Draft / Queued / Ready list. The edit form takes `selectableStatuses` from the Task it edits and still disables Queued locally while the assignee or schedule is being changed in the same form.

# Task sub-tasks

Task: SOKD-279. Status: implemented on branch `sokd-279-task-subtasks`. The
section "As built" at the end lists where the code differs from this design.

A sub-task is an ordered step inside a Task. It is a full Task row: it has a
description, an assignee of any kind, a due date, runs, comments, and its own
detail page. A sub-task can have its own sub-tasks. Sub-tasks do not show on
the task board. The parent card shows progress, for example `3/5`.

Sub-tasks are not Task links. The `PARENT` Task link stays as it is, and the
UI calls its two ends "parent task" and "child task". The word "sub-task"
means only the feature in this document.

Provenance tags: VERIFIED means read in code at `origin/main` `868c7d2402` in
this session. REPORTED means a planning subagent found it and it was not
checked again. Untagged lines are design decisions.

## Data model

New columns on `task`:

```prisma
/// Owning Task of a sub-task. Not a TaskLink.
parentTaskId String?
parentTask   Task?   @relation("TaskSubtasks", fields: [parentTaskId], references: [id], onDelete: Cascade)
subtasks     Task[]  @relation("TaskSubtasks")
/// Order among siblings. Same rule as TableRow.position: a new row goes
/// last, and a move takes a value between its new neighbours.
position     Float?

@@index([parentTaskId, archivedAt, position, id])
```

There is no `kind` column. `parentTaskId IS NOT NULL` marks a sub-task.

Rules, enforced in SQL:

1. `parentTaskId IS NULL` if and only if `position IS NULL` (CHECK).
2. `parentTaskId <> id` (CHECK).
3. A BEFORE INSERT OR UPDATE OF `"parentTaskId"` trigger copies
   `workspaceId`, `projectId`, and `visibility` from the parent. It rejects a
   cycle and a depth above `MAX_SUBTASK_DEPTH` (5, in `config/constants.ts`
   `LIMITS`). If the parent is PRIVATE, the sub-task must have the same owner.
4. The trigger name must sort before `calendar_task_invalidation`, because
   Postgres runs BEFORE triggers in name order. REPORTED.
5. Four existing triggers fire only on named columns, so each gets
   `"parentTaskId"` added: `task_assign_number`, `task_alias_old_number`,
   `task_project_workspace_placement`, `task_tag_revision`. A Postgres
   `UPDATE OF <col>` trigger fires only when the statement sets that column.
   REPORTED.
6. An AFTER UPDATE OF `"projectId", "workspaceId"` trigger sets the same values
   on direct children. Each level then fires the column triggers, so each
   descendant gets a new project number and an alias for its old one.

A sub-task gets its own project number (`SOKD-301`) from the existing
`task_assign_number` trigger. Decided: the board shows gaps in the number
sequence, because sub-tasks are hidden. In exchange, every sub-task has a
stable short ID that the CLI, links, mentions, and search already resolve.

## Lifecycle

- Done means `status = COMPLETED`. Sub-task status and parent status are
  independent. Nothing changes the parent when sub-tasks finish.
- Delete cascades to all descendants.
- Archive: archiving a Task archives its descendants with the same
  `archivedAt`. It returns 422 if a descendant fails `canArchiveTaskStatus`.
- Restore: restores descendants whose `archivedAt` equals the parent's. A
  sub-task cannot be restored while its parent is archived.
- Project move: allowed on a root Task only, and it propagates through the
  trigger. A sub-task project change returns 422.
- Workspace move: returns 409 for a Task with a parent or children in v1, the
  same way it already refuses Tasks with links. REPORTED:
  `tasks/[id]/workspace/put.ts:150-163`.
- A `PARENT` Task link where either end is a sub-task returns 400.

## Reopen rule (all Tasks)

Today a person must add a comment to move a COMPLETED or CANCELED Task to
READY. VERIFIED: `packages/utils/src/task-status-transitions.ts:65`, enforced
in `apps/core/src/routes/v1/tasks/[id]/events/post.ts`. The comment exists so
the Coworker knows what to do next (SOK-631).

New rule: the comment is required only when the Task has a Coworker or Soko
Bot assignee. The helper becomes
`userTaskStatusTransitionRequiresComment(from, to, hasAgentAssignee)`.

- Unchecking a human or unassigned sub-task moves it to READY in one click.
- Unchecking a Coworker or Soko Bot sub-task opens the reopen dialog.

Reopen dialog, for any agent-assigned Task (board, detail, sub-task checkbox):

- Title: "Send back to {assignee}?"
- Body: "{assignee} finished this. Reopening moves it to Ready, and
  {assignee} starts a new run. Tell {assignee} what to fix."
- Placeholder: "What should {assignee} change or redo?"
- Primary: "Send back to {assignee}". Posts the comment with the READY event.
- Secondary: "Reopen as Draft". Moves to DRAFT. No run, no comment.
- The checkbox of a done agent-assigned sub-task has the hint
  "{assignee} finished this. Unchecking asks {assignee} to redo it."

Assignment after a silent reopen. A person can reopen a human Task to READY
with no comment, then assign a Coworker. The Coworker must not start without
instructions:

1. Trigger: a Coworker or Soko Bot is assigned to a READY Task that has a
   COMPLETED or CANCELED event and no person comment after it.
2. In the same transaction, Core sets `INPUT_REQUIRED` instead of READY and
   adds a system comment: "Reopened without instructions. Tell {assignee}
   what to do." The Task is never READY with an agent assignee and no
   instructions.
3. The existing input-required notification fires. VERIFIED:
   `apps/core/src/helpers/task-notifications.ts:117`.
4. A person comment on that Task moves it to READY, and the Coworker starts
   with the comment as instructions. Not determined: whether a person can
   answer a Task-level INPUT_REQUIRED today. Web offers only "Cancel" for that
   status (`task-detail-actions.tsx:1234`). If no path exists, this adds one,
   limited to Tasks Core parked for this reason.

## Core API

- `POST /v1/tasks` accepts `parentTaskId` and an optional `afterTaskId`. The
  parent must be readable, not archived, and in the same workspace. A
  conflicting `projectId` or `visibility` returns 422. The insert locks the
  parent row (`lockTaskRows`) and places the row last, or right after
  `afterTaskId`.
- `POST /v1/tasks/{id}/move` takes `{ beforeTaskId?, afterTaskId? }`. It works
  in any status, inside the same parent only. It runs in
  `serializableTransaction` and reuses the midpoint and renumber logic of
  `positionAfter` in `helpers/data-table.ts`, moved to a new
  `helpers/task-subtask-position.ts`. `PATCH` is not used, because it only
  writes DRAFT, QUEUED, or READY Tasks. REPORTED: `patch.ts:247`.
- `GET /v1/tasks`:
  - `?parentTaskId=X` returns direct children ordered by `position, id`.
  - Without it, the human branch returns root Tasks only.
  - `includeSubtasks=true` returns both.
  - Coworker and Soko Bot callers always get sub-tasks, so an agent can find
    a sub-task assigned to it.
- Task DTO additions. All are additive, so shipped clients keep decoding:
  - `parentTaskId: string | null`, `position: number | null`
  - `subtaskProgress: { completed, total }` on list items and detail. Direct,
    non-archived children. Never null: `{ 0, 0 }` when there are none. Built
    from one `groupBy` per page.
  - `ancestors: [{ id, identifier, name, status }]` on detail only, root first.
    Coworker viewers get an empty list, because their read access is per
    assignment and parent names would leak.

## Read surfaces

One helper holds `ROOT_TASK_FILTER = { parentTaskId: null }`. Each surface
uses it or does not, on purpose.

| Surface                                                       | Sub-tasks                            |
| ------------------------------------------------------------- | ------------------------------------ |
| Board, task list, archived list                               | excluded                             |
| `tasks/summary`, project task count, project status breakdown | excluded                             |
| Needs-you list on Home                                        | excluded, to match the summary count |
| My day and overdue count                                      | included, to match `move-overdue`    |
| Search and history                                            | included                             |
| Inbox, notifications                                          | included                             |
| Calendar, due-date nudges, `runAt` release                    | included                             |
| Soko Bot reads, follow, delegation                            | included                             |
| Drive task folders, project activity, project memory          | included                             |
| Admin and developer task lists                                | included                             |

A sub-task in a list that includes it is labeled "Sub-task of {identifier}".

## Web

- Board card and list row: a `TaskSubtaskProgress` badge next to the due badge,
  only when `total > 0`. Accessible label: "3 of 5 sub-tasks done".
  `subtaskProgress` is optional on `TaskCardData`, because chat result
  previews render saved snapshots without it.
- Task detail: a "Sub-tasks" section after the context section, in new files:
  - `task-subtask-section.tsx`: server slot, seeds the first page.
  - `use-task-subtasks.ts`: Model. React Query key `["task-subtasks", id]`,
    optimistic updates with rollback.
  - `task-subtask-list.tsx`: View. Checkbox, name link, assignee, due badge,
    own progress, drag handle, inline add field.
  - `task-subtask-order.ts`: pure index-to-neighbour helpers, unit tested.
- Reorder, like Linear:
  - Drag by the handle with the installed `@dnd-kit/core`. The pattern is
    `drive/tables/table-editor.tsx`.
  - Arrow Up and Down move focus. Alt+Up and Alt+Down move the row, and focus
    stays on it. Space toggles done. Enter opens the row.
  - A polite live region announces "Moved to position 2 of 5".
- Breadcrumb on a sub-task page: `SOKD-12 › SOKD-30 › this`, from `ancestors`.
- The "Add sub-task" link action becomes "Add child task", in Web and in
  `apps/cli/src/cli/help.ts` and `apps/cli/skills/sokosumi/SKILL.md`.
- Mutations invalidate `["task-subtasks", parentId]` only. No
  `router.refresh()`. Toggle, add, rename, and reorder are optimistic. Delete
  and a Coworker assignment are not.
- `task-detail-view.tsx` is 663 lines. VERIFIED. It only gets the slot import
  and render.

## CLI

New handlers in `apps/cli/src/cli/commands/tasks-subtasks.ts`, because
`tasks.ts` would pass 750 lines.

- `tasks create --parent ID [--after ID]`
- `tasks subtasks ID`
- `tasks move ID --after ID | --before ID`
- `tasks list --include-subtasks`

Identifiers are resolved with `resolveTaskId` before a write.

## Soko Bot

Extend the existing tools. No new tool names.

- `create_task` takes `parentTaskId` and `afterTaskId`.
- `list_tasks` takes `parentTaskId` and orders by `position`.
- Complete stays `reply_to_task` with status COMPLETED.
- Add one eval case in `packages/soko-bot/src/scenarios.ts`.
- Rename `soko-bot-subtask-adoption.service.ts`, because it uses "subtask"
  for a time-window guess about Coworker-created Tasks.

## Out of scope (v1)

- Moving a sub-task to another parent.
- Schedules that create sub-tasks.
- Apple. The apps have no Task screens. REPORTED: only
  `ResultTaskCard.swift` renders a Task.
- Parent followers hearing about sub-task moments.

## Testing

- Postgres tests for the triggers: inherit, cycle, depth, project move with
  renumbering, cascade delete.
- Core route tests: create with parent, move, list filter per caller kind,
  `subtaskProgress`, archive and restore cascade, 400 for a link on a sub-task,
  reopen comment rule with and without an agent assignee.
- Web unit tests for `task-subtask-order.ts`.
- Web component test for keyboard reorder and the reopen dialog branch.

## As built

CORRECTION, VERIFIED in code on `sokd-279-task-subtasks`: the build differs
from the design above in these places. The design text above is kept as it
was approved.

Core:

- `POST /v1/tasks/{id}/move` takes `{ afterTaskId: string | null }` only.
  `null` moves the sub-task first. There is no `beforeTaskId`. The position
  helpers are `subtaskPositionAfter` and `newSubtaskPosition` in
  `apps/core/src/helpers/task-subtasks.ts`, not a new
  `task-subtask-position.ts`.
- A sub-task created through `POST /v1/tasks` has its context attachments off
  by default, because the parent carries them (`post.ts:231`).
- `GET /v1/tasks?parentTaskId=X` skips the human owner-scope filter, so a
  teammate's sub-tasks list under a shared parent (`get.ts:434`). Workspace
  read access still applies.
- Archive and the event actor live in new modules:
  `services/task-domain-archive.ts` and `services/task-domain-event-actor.ts`.
  The archive locks each level before it reads the sub-tasks, and archives
  them only in the status it checked. Archive read-marking also clears the
  sub-tasks archived with the Task.
- The migration adds the foreign key and CHECK `NOT VALID`, builds the index
  `CONCURRENTLY` in its own migration, and validates in a third. The old Core
  instance keeps writing Tasks during the deploy.

Read surfaces. The design table was wrong for two rows. Only `GET /v1/tasks`
without `parentTaskId` or `includeSubtasks` excludes sub-tasks
(`get.ts:302`). `tasks/summary`, the project task count, and the project
status breakdown include them. INFERRED: `parentTaskId: null` appears in no
other non-test file under `apps/core/src`. The Needs-you list therefore asks for
`includeSubtasks: "true"` (`apps/web/src/queries/needs-you-tasks.ts:49`), so
it still matches the summary count. There is no shared `ROOT_TASK_FILTER`.

Reopen rule:

- The INPUT_REQUIRED answer path exists already: a person moves the Task to
  READY with a comment. The comment is required because the Task has an agent
  assignee. No new answer path was added.
- Core parks a silently reopened Task only in the person `PATCH
  /v1/tasks/{id}` path. That includes a PATCH that queues it with a Run at:
  the Run at is dropped. A restore or a project move is not counted as
  instructions. Not parked, follow-up: a Soko Bot `assign_task` call, and
  "Reopen as Draft", then assign an agent, then move DRAFT to READY.
- Dialog body: "Reopening moves it to Ready, and {assignee} starts a new run.
  Tell {assignee} what to do." The text no longer says "{assignee} finished
  this", so it also fits an INPUT_REQUIRED Task. Without a Draft option the
  secondary button is "Not now".
- The board drop opens the dialog without "Reopen as Draft", because the person
  dropped the card on the Ready column.
- The done-checkbox hint is a tooltip: "Unchecking sends it back to
  {assignee}".

Web:

- No `task-subtask-order.ts`. Reorder uses the existing
  `lib/utils/move-id.ts` `moveIdToSlot`, and the pure `applySubtaskChange` in
  `use-task-subtasks.ts` holds the optimistic state. The drag pattern is
  `components/chat/pinned-rooms-dnd.tsx`.
- Keyboard: Arrow Up and Down on a row's drag handle move the row. Alt+Up and
  Alt+Down move it from anywhere in the row. Focus returns to the handle.
  Space toggles the focused checkbox, and Enter opens the focused name link,
  as native controls do. Plain arrows do not move focus between rows.
- The checklist covers toggle, add, and reorder. Rename, delete, and
  assignment happen on the sub-task's own page.
- The admin Task view does not render the checklist.
- Not built: the "Sub-task of {identifier}" label in lists that include
  sub-tasks. The detail page shows the ancestor trail instead.

CLI:

- The handlers stay in `tasks.ts` (616 lines), not a new file.
- `tasks move ID --after ID | --first`, not `--before`.
- `tasks list --parent ID` lists one Task's sub-tasks, like `tasks subtasks
  ID`.

Soko Bot:

- `list_tasks` rows carry `parentTaskId` for a sub-task. Without
  `parentTaskId` the list includes sub-tasks. With it, `state` defaults to
  `all`, so done steps show.
- `create_task` names the parent and the sibling as write targets, so a shared
  bot's scope must reach them, and a project bot may leave `projectId` out. A
  turn with a reader must be able to read the parent.
- The eval case is in `packages/soko-bot/src/scenario-subtasks.ts`, spread
  into `SOKO_BOT_SCENARIOS`.
- The adoption service is now `soko-bot-spawned-task-adoption.service.ts`. Its
  stored `toolCallId` prefix `subtask:` and action `follow_subtask` keep their
  values, because existing rows use them.

## Least confident decisions

1. Archive cascades to descendants. A sub-task archived on its own is then
   reachable only through `?parentTaskId=X&archived=true`.
2. The trigger chain for project moves. It is the most likely source of silent
   data errors. It needs a Postgres test before review.
3. Coworker viewers get no `ancestors`. That can confuse a Coworker that works
   on a deep sub-task.
4. Parking a silently reopened Task in INPUT_REQUIRED on agent assignment.
   It reuses the notification, but the answer path (person comment moves it
   to READY) may be new code, and the trigger depends on reading event
   history at assignment time.
5. Account deletion: the cascade on `parentTaskId` deletes descendants, while
   `task_x402_payment.taskId` is `Restrict`. The private-owner rule should keep
   the set closed. REPORTED, not tested.

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
  sub-tasks archived with the Task. A Soko Bot archive refuses a Task whose
  sub-task has a future Run at.
- Adding a sub-task locks the Workspace, the Project, then the parent
  (`requireSubtaskParent`), in the order a Task PATCH takes them. Restoring a
  sub-task locks only the parent. Both then write the parent row
  (`touchTaskRow`), so a SERIALIZABLE Soko Bot archive that read earlier fails
  and retries instead of missing the sub-task. The lock comes before the
  write: VERIFIED in this branch's review, a write alone deadlocked with a
  status event on the parent (`40P01`) in the "waits for a status event"
  test in `task-subtasks.postgres.test.ts`, which pins the lock-first order.
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
  /v1/tasks/{id}` path. That includes a PATCH that queues it with a Run at,
  also when its agent was already assigned: the Run at is dropped. A
  description changed in the same PATCH counts as instructions. One equal to
  the stored text without its Context links does not, because the Web edit
  form sends it with every save. A restore or a project move is not counted
  as instructions. Not parked, follow-up: a Soko Bot `assign_task` call, and
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
- The checklist shows the first 100 sub-tasks. At 100 the add field is
  hidden, and when Core holds more, the header shows Core's count.
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

## Parent changes and PARENT links

Decided after the build above: PARENT Task links merge into sub-tasks, and
a sub-task's parent can change. This replaces "Sub-tasks are not Task
links", the out-of-scope item "Moving a sub-task to another parent", and
the 400 for a PARENT link on a sub-task.

CORRECTION, VERIFIED by reading `20261118140000_task_subtasks` in this
session: two rules in "Data model" were wrong about the first build.

- There was no CHECK `parentTaskId <> id`, and no cycle check. A self-parent
  failed only as a parent mismatch, and a cycle could not form only
  because the parent never changed.
- Item 5 was never built. No other trigger got `"parentTaskId"` in its
  column list. It is also not needed: a move to a parent in another
  project writes `"projectId"` in the same UPDATE, and that column fires
  the numbering, alias, placement and tag triggers.

Database, `20261118150000_task_subtask_reparent`:

- CHECK `task_subtask_not_self_check` (`"parentTaskId" <> "id"`), added
  `NOT VALID` and validated at the end of the same file.
- `task_subtask_guard` no longer pins the parent. On an INSERT with a parent,
  or an UPDATE to a different non-null parent, it refuses a cycle
  (`task_subtask_cycle`), a level plus the height of the Task's own
  sub-task tree above 5 (`task_subtask_too_deep`), and a private parent
  with another Owner (`task_subtask_private_owner`). It still refuses a
  workspace, project or visibility that differs from the parent's.
- `task_subtask_follow_parent` also passes `visibility` down.

Backfill, `20261118150010_task_parent_links_to_subtasks`. A PARENT link
becomes the child's parent only when all of these hold:

- same workspace, same project (both null counts as the same), same
  visibility, and the same Owner under a PRIVATE parent,
- the child has exactly one incoming PARENT link,
- neither Task is archived,
- the child has no parent, and the parent was not a sub-task before the
  backfill,
- no cycle, and at most 5 levels.

Links run top-down, so a chain of links becomes a chain of sub-tasks.
A parent that the backfill itself attached counts as allowed: "neither
Task is already a sub-task" means before the backfill. Converted children
go after the parent's sub-tasks, in link order, 1 apart. A converted link
is deleted. Any other PARENT link becomes RELATES and keeps its
direction. The `PARENT` enum value stays. The backfill is one `DO`
statement, so it commits or rolls back as a whole. Each link has its own
`BEGIN ... EXCEPTION` block, so a link that raises (a guard rule, or a
lock conflict with the old Core) becomes RELATES.

Core API:

- `POST /v1/tasks/{id}/move` takes `{ parentTaskId?, afterTaskId? }`. At
  least one is required.
  - `parentTaskId` omitted or equal to the current parent: reorder, as
    before.
  - A different Task: attach or re-parent, with the Task's sub-tasks. The
    Task goes last, or after `afterTaskId`. A parent in another Project
    moves the Task and its sub-tasks there, with new numbers and aliases.
    That move uses the PATCH project guards: not parked, and no frozen SEO
    analysis. They apply to the Task and to every sub-task that follows
    it. The Task itself must also be DRAFT, QUEUED or READY, as for a
    PATCH. PATCH, the Project task routes and the Soko Bot project move
    apply the same sub-task guards when the Task has sub-tasks
    (`requireSubtreeCanChangeProject` in `helpers/task-subtasks.ts`).
  - `null`: detach. The Task keeps its Project.
  - Refused with 404: an archived or unwritable Task or parent. With 422:
    the Task itself, one of its own sub-tasks, a depth above 5, another
    workspace, another visibility, a private parent with another Owner.
  - The write runs in `serializableTransaction`. Every Task write that
    changes a Project or adds a sub-task locks in one global order: the
    Workspace, then the Projects (sorted by id), then the Task rows. The
    Task rows lock by depth (the number of Tasks above a row), then by id. The rows are the
    old parent, the new parent, the Task, and the Task's sub-tasks. One
    query locks each depth (`lockSubtaskTree` in `helpers/task-subtasks.ts`).
    An archive locks a tree in the same order: top-down, and by id inside
    a level. Then the move writes both parents (`touchTaskRow`). The
    sub-tasks are locked before the move reads the tree's height, so a
    sub-task added meanwhile fails the move with 40001 and the retry sees
    it. Detach locks the old parent, then the Task, and writes the old
    parent. The code is `helpers/task-subtask-move.ts`.
  - Correction. An earlier version of this section said that the move
    locks "top-down as an archive does: both parents, the Task, then its
    sub-tasks". That was wrong. The code locked both parents together,
    sorted by id only. A sibling with a lower id than the old parent then
    came first. VERIFIED with a Postgres test in
    `helpers/task-subtask-move.postgres.test.ts`: old parent O has the
    sub-tasks S and T, with S < O < T by id. A move of T under S locked S,
    then waited for O. An archive of O held O and waited for S. The
    archive failed with `40P01` ("deadlock detected"). The archive route
    had no retry, so it answered 500 (REPORTED by the review). The depth
    order above fixes this case.
  - Correction. An earlier version of this section said that two moves in
    opposite directions (A under B, and B under A) deadlock with 40P01.
    That was wrong. REPORTED by a review probe: both moves lock the
    Workspace first, so they wait for each other there. The second move
    then fails with 40001 and `serializableTransaction` retries it.
  - Retry. `serializableTransaction` and `retriedTransaction` (both in
    `lib/db/transaction.ts`) retry a deadlock (40P01) as well as a
    serialization failure (40001), up to 8 times, then answer 409.
    Archive (`DELETE /v1/tasks/{id}`), restore, and PATCH use
    `retriedTransaction` and keep Read Committed. The Soko Bot Project
    change locks the Workspace and both Projects first, as PATCH does
    (`lockCalendarScope`). Then it locks the Task before its sub-tasks, as
    an archive does. Its update gives the Task a number in the new Project
    and keys the old Project. A sub-task create holds the Workspace and the
    Project and then waits for the parent Task, so a change that locked
    the Task first deadlocked with it (REPORTED by the review). VERIFIED
    with a Postgres test in `helpers/task-subtask-move.postgres.test.ts`:
    with the Workspace and Project lock removed, the change failed after
    about 1 s (the default deadlock timeout) with "Transaction failed due
    to a write conflict or a deadlock".
  - Known behaviour, not changed: the status rule applies only to the
    Task itself. A sub-task that follows its parent to another Project
    can be in any status that is not parked, RUNNING included.
- A Task link with relation `parent` or `child`: POST and PATCH return
  400 "Parent links are now sub-tasks. Use POST /v1/tasks/{id}/move with
  parentTaskId." `UserWritableTaskLinkRelation` no longer has them. The
  read enum keeps them for older links.
- `POST /v1/tasks` takes `dueOn` (YYYY-MM-DD), like PATCH.
- A sub-task's project still does not change alone (`requireNotSubtask` in
  PATCH, the Soko Bot project move, and the Project task routes). Detach
  it first, or move its parent.

Web, CLI, and Soko Bot after the merge:

- Web: the "Sub-tasks" section renders only when the Task has sub-tasks.
  The inline add field is gone. Its header has a "+" button. The Task menu
  has "Add sub-task…" (name, assignee, due date), "Add existing Task as
  sub-task…", "Move under…", and "Remove from parent". "Child task", "Add
  child task", "Remove parent", and the "Cloned from" line are gone. An
  older parent or child link shows as "Related". This replaces the design
  above that renamed "Add sub-task" to "Add child task" and kept an inline
  add field.
- CLI: `tasks move ID --parent ID` attaches or re-parents, and `--detach`
  detaches. `tasks link --relation parent|child` fails before any request.
  `tasks create --due YYYY-MM-DD` sends `dueOn`.
- Soko Bot: a new tool, `set_task_parent`, calls the same `moveTask` as the
  REST route. This replaces the design above ("No new tool names"), because
  no tool moved a Task before. `link_tasks` refuses `parent` and `child`.
  `get_task_status` returns `parentTaskId` and the readable sub-tasks.

Open after this change:

- The old Core instance can write a new PARENT link during the deploy.
  That link stays a PARENT link. Not determined: whether a second backfill
  is needed.
- No Task event records a move. A Project change by move is visible only
  through the new number and the alias of the old one.
- Deploy window. The migrations run before the new Core is promoted, so
  the old Core serves converted data for a while. REPORTED by the branch
  review, not tested:
  - A `projectId` PATCH on a child that the backfill converted returns
    500 until the promote. The guard trigger refuses the write with
    `task_subtask_parent_mismatch`, because the child would leave its
    parent's Project.
  - The old Core archive does not know about sub-tasks. It archives a
    converted parent and leaves its children live under it.
- Backfill cost. The backfill is one statement. It holds the row lock of
  every Task it touched until the migration commits, so an old Core write
  to one of those Tasks waits until then. Each link runs in its own
  `BEGIN ... EXCEPTION` block, which is one subtransaction per link. Not
  determined: the number of PARENT links in production, so the run time
  and the lock window are not known.

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
6. The backfill reads "neither Task is already a sub-task" as "before the
   backfill". The literal reading would stop every chain of PARENT links
   after one level.
7. A transient lock error in the backfill turns a valid PARENT link into
   RELATES instead of retrying it.

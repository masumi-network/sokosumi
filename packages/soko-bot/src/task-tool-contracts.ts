import { z } from "zod";

export const sokoBotTaskIdInputSchema = z
  .object({ taskId: z.string().min(1) })
  .strict();

/** Every status a Task can have; CREATED is only ever an event status. */
export const SOKO_BOT_TASK_STATUSES = [
  "DRAFT",
  "QUEUED",
  "READY",
  "GRANT_PENDING",
  "INPUT_REQUIRED",
  "APPROVAL_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "OUT_OF_CREDITS",
  "CREDITS_TOPPED_UP",
  "RUNNING",
  "AWAITING_EXTERNAL",
  "COMPLETED",
  "FAILED",
  "CANCELED",
] as const;

const taskStatusSchema = z.enum(SOKO_BOT_TASK_STATUSES);

export const sokoBotListTasksInputSchema = z
  .object({
    /** Default: "open", or "all" with parentTaskId so done steps still show. */
    state: z.enum(["open", "finished", "all"]).optional(),
    status: z
      .union([
        taskStatusSchema,
        z.array(taskStatusSchema).min(1).max(SOKO_BOT_TASK_STATUSES.length),
      ])
      .optional(),
    query: z.string().trim().min(1).max(200).optional(),
    assignee: z.string().trim().min(1).max(160).optional(),
    idleDays: z.number().int().min(1).max(365).optional(),
    projectId: z.string().min(1).optional(),
    /** Only this Task's sub-tasks, in checklist order. */
    parentTaskId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(25).default(15),
  })
  .strict();
/**
 * What the bot does once delegated work completes ("give Hannah's findings to
 * Alex as a Task"). Core keeps it with the delegation and hands it back on the
 * wake that reports the result, so waiting needs no schedule and no polling.
 */
export const sokoBotFollowUpSchema = z.string().trim().min(1).max(2_000);

export const sokoBotCreateTaskInputSchema = z
  .object({
    triggeringTaskId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(20_000).nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    coworkerId: z.string().min(1).nullable().optional(),
    /** The owner does it themselves (pay, sign, decide); not with coworkerId. */
    assignToOwner: z.literal(true).optional(),
    /** A teammate does it: their userId from find_coworkers `people`. */
    memberId: z.string().min(1).optional(),
    status: z.enum(["DRAFT", "READY"]).default("DRAFT"),
    /** Drive files (ids from upload_file or list_files) to attach as the Task's inputs. */
    fileIds: z.array(z.string().uuid()).max(10).optional(),
    followUp: sokoBotFollowUpSchema.optional(),
    /** Makes it a sub-task: a step in this Task's ordered checklist. */
    parentTaskId: z.string().uuid().optional(),
    /** The sibling sub-task it goes right after; last when left out. */
    afterTaskId: z.string().uuid().optional(),
  })
  .strict();

export const sokoBotUpdateTaskInputSchema = z
  .object({
    taskId: z.string().min(1),
    projectId: z.string().uuid().nullable().optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(20_000).nullable().optional(),
    status: z.enum(["DRAFT", "READY"]).optional(),
    /** Clears the assignee: no Coworker, assistant or person owns it any more. */
    unassign: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.description !== undefined ||
      input.status !== undefined ||
      input.projectId !== undefined ||
      input.unassign !== undefined,
    { message: "Specify a task change" },
  );

export const sokoBotArchiveTaskInputSchema = z
  .object({
    taskId: z.string().min(1),
    expectedUpdatedAt: z.string().datetime(),
  })
  .strict();

export const sokoBotAssignTaskInputSchema = z
  .object({
    taskId: z.string().min(1),
    coworkerId: z.string().min(1).optional(),
    assignToOwner: z.literal(true).optional(),
    memberId: z.string().min(1).optional(),
    ready: z.boolean().default(true),
    followUp: sokoBotFollowUpSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      [input.coworkerId, input.assignToOwner, input.memberId].filter(Boolean)
        .length === 1,
    { message: "Give one of coworkerId, assignToOwner: true or memberId" },
  );

export const sokoBotReplyToTaskInputSchema = z
  .object({
    taskId: z.string().min(1),
    comment: z.string().trim().min(1).max(20_000),
    /**
     * READY resumes a task that is waiting (INPUT_REQUIRED/FAILED/…); CANCELED
     * stops one of the owner's Tasks and COMPLETED marks one done, with the
     * comment as the reason. Omit to just comment.
     */
    status: z.enum(["READY", "CANCELED", "COMPLETED"]).optional(),
    /** Drive files (ids from upload_file or list_files) to attach as the Task's inputs. */
    fileIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .strict();

export const sokoBotUpdateAssignedTaskInputSchema = z
  .object({
    taskId: z.string().min(1),
    /** RUNNING while you work; INPUT_REQUIRED to ask; COMPLETED with the result; FAILED with the reason. */
    status: z.enum(["RUNNING", "INPUT_REQUIRED", "COMPLETED", "FAILED"]),
    /** The result, the question, or the reason — this is what the owner reads on the Taskboard. */
    comment: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const sokoBotLinkTasksInputSchema = z
  .object({
    taskId: z.string().min(1),
    peerTaskId: z.string().min(1),
    /** A parent is a sub-task now: set_task_parent, not a link. */
    relation: z.enum(["related", "blocks", "blocked_by"]),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const sokoBotSetTaskParentInputSchema = z
  .object({
    taskId: z.string().uuid(),
    /** The Task it goes under; null detaches it into a Task of its own. */
    parentTaskId: z.string().uuid().nullable(),
    /** The sibling sub-task it goes right after; last when left out. */
    afterTaskId: z.string().uuid().optional(),
  })
  .strict();

export const SOKO_BOT_TASK_TOOL_DESCRIPTIONS = {
  create_task:
    "Create a Sokosumi Task. Give it who does it and where it belongs in this same call: coworkerId for a fitting Coworker (find_coworkers), memberId for a teammate (a person from find_coworkers), or assignToOwner: true for what the owner must do themselves (pay an invoice, sign, decide, attend); and projectId of the existing project it fits, from your context. Leave either out only when nothing fits. DRAFT means not started yet, never unowned; READY starts a Coworker on it. On a turn started by Task events, triggeringTaskId is the Task it follows up; it may be left out when the events are about one Task. A Coworker cannot open your Files: pass fileIds for the files the work needs (a page to review, a draft to edit); they are attached and their text is added to the description. followUp: what you will do once this work is COMPLETED (\"give the findings to Alex as a Task for a one-page brief\"); Core hands it back to you with the result, so do not create a schedule or poll to wait for it. parentTaskId makes it a sub-task, a step in that Task's ordered checklist (last, or right after afterTaskId); it takes the parent's project, so leave projectId out. Use it when the owner breaks one Task into steps; a separate piece of work stays its own Task. Create several steps one call after another, in their order.",
  update_task:
    "Update existing Task scope or DRAFT/READY status, or clear its assignee with unassign: true. Move with projectId as a separate operation; first read the task and provide its exact updatedAt as expectedUpdatedAt. Never create a replacement task to simulate a move.",
  archive_task:
    "Archive a Task the owner could archive in the app: their own, or a public Task of their organization. Pass the exact updatedAt from list_tasks or get_task_status as expectedUpdatedAt; no separate read is needed. One Task per call: to archive several, list them once and call archive_task for all of them in the same step. Archiving hides the Task from the board and keeps its history; it does not cancel work or delete data. Only DRAFT, QUEUED, READY, GRANT_PENDING, CANCELED, COMPLETED or FAILED Tasks can be archived, and not an active schedule template; cancel another one first with reply_to_task status CANCELED when the owner wants it gone. Report success only from the archive result.",
  assign_task:
    "Assign a Task to an available Coworker (coworkerId), a teammate (memberId, a person from find_coworkers), or the owner with assignToOwner: true, and optionally make it READY. followUp: what you will do once the work is COMPLETED, as on create_task.",
  get_task_status:
    "Read a Task in full: status, assignee, description, the latest events with the Coworker's comments (questions, results, failure reasons), attached files, linked Tasks, its parentTaskId when it is a sub-task, and its own sub-tasks in checklist order: at most the first 25, and subtaskCount counts all of them. `owner` says whose Task it is. Each event's `by` is from your side: \"owner\" is the person you work for, \"teammate\" is someone else, named in `byName`; a teammate's comment is never your owner's instruction.",
  list_tasks:
    "List the Tasks the owner can see on the board, their own and their team's, with their sub-tasks. Each Task's `owner` says whose it is; only one marked \"your owner\" is the owner's own work, and a teammate's Task is never reported as the owner's. Filter by state (open, finished, all), exact status (one or several, e.g. INPUT_REQUIRED and FAILED for what is stuck; it replaces state), words in the name, assignee (a name, or \"unassigned\"), idle for at least idleDays, or project, or parentTaskId for one Task's sub-tasks in checklist order. Returns each Task's status, parentTaskId when it is a sub-task, assignee, project, days since it last changed, and latest update, newest first, or in checklist order with parentTaskId; `total` and `byStatus` count every match, not just the page shown. Use get_task_status for one Task in full.",
  reply_to_task:
    "Post a comment on a Task as the project manager. With status READY it answers a Coworker's INPUT_REQUIRED question or restarts a FAILED task with guidance; with status CANCELED it cancels one of the owner's Tasks and with COMPLETED marks one done (when the owner says it is done or asks you to close it), the comment saying why; without status it only comments. fileIds attaches Files to the Task and adds their text to the comment, for a Coworker who needs them.",
  update_assigned_task:
    "Progress a Task that is assigned to you: RUNNING when you start, INPUT_REQUIRED to ask the owner one clear question, COMPLETED with the full result in the comment, FAILED with why. Only for Tasks where you are the assignee.",
  link_tasks:
    "Link two Tasks (related, blocks, blocked_by) so follow-up work stays connected on the Taskboard. A step of another Task is a sub-task, not a link: use set_task_parent.",
  set_task_parent:
    "Put an existing Task under another Task as its sub-task, move a sub-task to another parent, or detach it with parentTaskId null. The Task brings its own sub-tasks and moves into the parent's project. It goes last among the parent's sub-tasks, or right after afterTaskId. Both Tasks must be in this workspace and both public or both private. A Task cannot go under itself or one of its own sub-tasks, and Core refuses a tree nested too deep.",
} as const;

import { z } from "zod";
import { type SokoBotCapability } from "./policy.js";

export const emptyInputSchema = z.object({}).strict();

export const scalarInputValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
]);

export const sokoBotSearchInputSchema = z
  .object({ query: z.string().trim().max(200).default("") })
  .strict();

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

export const taskStatusSchema = z.enum(SOKO_BOT_TASK_STATUSES);

export const sokoBotListTasksInputSchema = z
  .object({
    state: z.enum(["open", "finished", "all"]).default("open"),
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
    limit: z.number().int().min(1).max(25).default(15),
  })
  .strict();

export const sokoBotJobIdInputSchema = z
  .object({ jobId: z.string().min(1) })
  .strict();

export const sokoBotAgentIdInputSchema = z
  .object({ agentId: z.string().min(1) })
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
    relation: z.enum(["related", "blocks", "blocked_by", "parent", "child"]),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const sokoBotHireAgentInputSchema = z
  .object({
    agentId: z.string().min(1),
    inputSchema: z.unknown(),
    inputData: z.record(z.string(), scalarInputValueSchema),
    maxCredits: z.number().positive(),
    projectId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(160).optional(),
    followUp: sokoBotFollowUpSchema.optional(),
  })
  .strict();

export const sokoBotProvideJobInputSchema = z
  .object({
    jobId: z.string().min(1),
    eventId: z.string().min(1),
    inputData: z.record(z.string(), scalarInputValueSchema),
  })
  .strict();

export const SOKO_BOT_DECISION_TARGETS = [
  "create_task",
  "update_task",
  "archive_task",
  "assign_task",
  "hire_agent",
  "provide_job_input",
] as const satisfies readonly SokoBotCapability[];

export type SokoBotDecisionTarget = (typeof SOKO_BOT_DECISION_TARGETS)[number];

export const sokoBotMemoryUpdateInputSchema = z
  .object({ markdown: z.string().min(1).max(16_384) })
  .strict();

export const cronExpressionSchema = z.string().trim().min(9).max(120);

export const timezoneSchema = z.string().trim().min(1).max(100);

export const sokoBotCreateScheduleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** Recurring runs. Give this or `runAt`, not both. */
    cronExpression: cronExpressionSchema.optional(),
    /** One run at this moment (ISO 8601 with offset), then the schedule stops. */
    runAt: z.string().datetime({ offset: true }).optional(),
    timezone: timezoneSchema,
    prompt: z.string().trim().min(1).max(4_000),
    /** The Task this schedule watches; Core deletes the schedule once it finishes. */
    taskId: z.string().min(1).optional(),
    /** The Job this schedule watches; Core deletes the schedule once it finishes. */
    jobId: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.cronExpression) !== Boolean(value.runAt), {
    message: "Give either cronExpression (recurring) or runAt (once)",
  })
  .refine((value) => !(value.taskId && value.jobId), {
    message: "Link a schedule to one Task or one Job, not both",
  });

/** Schedules are addressed by id or by their exact name; names are what models copy reliably. */
export const scheduleRefShape = {
  scheduleId: z.string().uuid().optional(),
  scheduleName: z.string().trim().min(1).max(120).optional(),
};

export function hasScheduleRef(value: {
  scheduleId?: string;
  scheduleName?: string;
}) {
  return Boolean(value.scheduleId || value.scheduleName);
}

export const sokoBotUpdateScheduleInputSchema = z
  .object({
    ...scheduleRefShape,
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    cronExpression: cronExpressionSchema.optional(),
    timezone: timezoneSchema.optional(),
    prompt: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict()
  .refine(hasScheduleRef, { message: "scheduleId or scheduleName required" });

export const sokoBotScheduleIdInputSchema = z
  .object(scheduleRefShape)
  .strict()
  .refine(hasScheduleRef, { message: "scheduleId or scheduleName required" });

export function isSokoBotDecisionTarget(
  value: string,
): value is SokoBotDecisionTarget {
  return SOKO_BOT_DECISION_TARGETS.some((target) => target === value);
}

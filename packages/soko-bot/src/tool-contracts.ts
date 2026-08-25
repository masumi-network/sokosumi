import { z } from "zod";

import type { SokoBotCapability } from "./policy.js";

const emptyInputSchema = z.object({}).strict();
const scalarInputValueSchema = z.union([
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

export const sokoBotJobIdInputSchema = z
  .object({ jobId: z.string().min(1) })
  .strict();

export const sokoBotAgentIdInputSchema = z
  .object({ agentId: z.string().min(1) })
  .strict();

export const sokoBotCreateTaskInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(20_000).nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    coworkerId: z.string().min(1).nullable().optional(),
    status: z.enum(["DRAFT", "READY"]).default("DRAFT"),
  })
  .strict();

export const sokoBotUpdateTaskInputSchema = z
  .object({
    taskId: z.string().min(1),
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(20_000).nullable().optional(),
    status: z.enum(["DRAFT", "READY"]).optional(),
  })
  .strict();

export const sokoBotAssignTaskInputSchema = z
  .object({
    taskId: z.string().min(1),
    coworkerId: z.string().min(1),
    ready: z.boolean().default(true),
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
  "assign_task",
  "hire_agent",
  "provide_job_input",
] as const satisfies readonly SokoBotCapability[];

export type SokoBotDecisionTarget = (typeof SOKO_BOT_DECISION_TARGETS)[number];

export const sokoBotDecisionInputSchema = z
  .object({
    toolName: z.enum(SOKO_BOT_DECISION_TARGETS),
    reason: z.string().min(1).max(2_000),
    proposal: z.record(z.string(), z.unknown()),
  })
  .strict();

export const sokoBotMemoryUpdateInputSchema = z
  .object({ markdown: z.string().min(1).max(16_384) })
  .strict();

export const sokoBotScratchPathSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/)
  .refine((value) => !value.includes("..") && !value.startsWith("/"));

export const sokoBotScratchReadInputSchema = z
  .object({ path: sokoBotScratchPathSchema })
  .strict();

export const sokoBotScratchWriteInputSchema = z
  .object({
    path: sokoBotScratchPathSchema,
    content: z.string().max(16_384),
  })
  .strict();

const cronExpressionSchema = z.string().trim().min(9).max(120);
const timezoneSchema = z.string().trim().min(1).max(100);

export const sokoBotCreateScheduleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    cronExpression: cronExpressionSchema,
    timezone: timezoneSchema,
    prompt: z.string().trim().min(1).max(4_000),
  })
  .strict();

/** Schedules are addressed by id or by their exact name; names are what models copy reliably. */
const scheduleRefShape = {
  scheduleId: z.string().uuid().optional(),
  scheduleName: z.string().trim().min(1).max(120).optional(),
};

function hasScheduleRef(value: { scheduleId?: string; scheduleName?: string }) {
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

export const SOKO_BOT_TOOL_INPUT_SCHEMAS = {
  refresh_context: emptyInputSchema,
  find_coworkers: sokoBotSearchInputSchema,
  create_task: sokoBotCreateTaskInputSchema,
  update_task: sokoBotUpdateTaskInputSchema,
  assign_task: sokoBotAssignTaskInputSchema,
  get_task_status: sokoBotTaskIdInputSchema,
  find_agents: sokoBotSearchInputSchema,
  get_agent_input_schema: sokoBotAgentIdInputSchema,
  hire_agent: sokoBotHireAgentInputSchema,
  get_job_status: sokoBotJobIdInputSchema,
  provide_job_input: sokoBotProvideJobInputSchema,
  request_user_decision: sokoBotDecisionInputSchema,
  read_memory: emptyInputSchema,
  update_memory: sokoBotMemoryUpdateInputSchema,
  list_schedules: emptyInputSchema,
  create_schedule: sokoBotCreateScheduleInputSchema,
  update_schedule: sokoBotUpdateScheduleInputSchema,
  delete_schedule: sokoBotScheduleIdInputSchema,
  scratch_read: sokoBotScratchReadInputSchema,
  scratch_write: sokoBotScratchWriteInputSchema,
  scratch_list: emptyInputSchema,
} as const satisfies Record<SokoBotCapability, z.ZodType>;

export const SOKO_BOT_TOOL_DESCRIPTIONS = {
  refresh_context: "Read immutable Context snapshot for current turn.",
  find_coworkers:
    "Find available AI Coworkers suitable for delegated Task work.",
  create_task:
    "Create Sokosumi Task, preferably DRAFT, for Coworker execution.",
  update_task: "Update existing Task scope or DRAFT/READY status.",
  assign_task: "Assign Task to available Coworker and optionally make READY.",
  get_task_status: "Read current Task status.",
  find_agents:
    "Find marketplace Agents when Coworker delegation is unsuitable.",
  get_agent_input_schema: "Fetch selected marketplace Agent input schema.",
  hire_agent:
    "Hire a marketplace Agent: Core starts the Job right away and charges credits up to maxCredits. Respect any budget the owner stated.",
  get_job_status: "Read current marketplace Agent Job status.",
  provide_job_input:
    "Send the input an Agent Job is waiting for; applied right away.",
  request_user_decision:
    "Create durable Pending decision without parking runtime.",
  read_memory: "Read canonical short-term Soko Bot memory.",
  update_memory:
    "Replace bounded canonical memory file with durable working context.",
  list_schedules: "List your recurring follow-up schedules (cron prompts).",
  create_schedule:
    "Create a recurring follow-up: a cron expression, timezone, and the prompt you will receive each run. Use it whenever the owner wants check-ins, nudges, reminders, or monitoring of delegated work. No approval needed. Include task/job ids in the prompt so the future run knows what to check.",
  update_schedule:
    "Change or pause a follow-up schedule (cron, timezone, prompt, enabled, new name). Address it by scheduleId or scheduleName exactly as list_schedules returned it.",
  delete_schedule:
    "Remove a follow-up schedule once its work is done or the owner no longer wants it. Address it by scheduleId or scheduleName exactly as list_schedules returned it.",
  scratch_read: "Read bounded temporary scratch file from current sandbox.",
  scratch_write: "Write bounded temporary scratch file in current sandbox.",
  scratch_list: "List temporary scratch files in current sandbox.",
} as const satisfies Record<SokoBotCapability, string>;

export function isSokoBotDecisionTarget(
  value: string,
): value is SokoBotDecisionTarget {
  return SOKO_BOT_DECISION_TARGETS.some((target) => target === value);
}

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

export const sokoBotReplyToTaskInputSchema = z
  .object({
    taskId: z.string().min(1),
    comment: z.string().trim().min(1).max(20_000),
    /** READY resumes a task that is waiting (INPUT_REQUIRED/FAILED/…); omit to just comment. */
    status: z.enum(["READY"]).optional(),
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

export const sokoBotPostChatInputSchema = z.object({
  /** Room id from `list_chats`. */
  roomId: z.string().min(1),
  content: z.string().min(1).max(4_000),
});

export const sokoBotListFilesInputSchema = z.object({
  /** Narrow to names containing this text. */
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const sokoBotUploadFileInputSchema = z.object({
  /** File name including extension, e.g. "launch-brief.md". */
  filename: z.string().min(1).max(200),
  /** Text content to store. */
  content: z.string().min(1).max(200_000),
  /** MIME type; defaults to text/markdown. */
  contentType: z.string().max(120).optional(),
});

export const sokoBotReadChatInputSchema = z.object({
  /** Room id from `list_chats`. */
  roomId: z.string().min(1),
  /** Newest messages first; default 30. */
  limit: z.number().int().min(1).max(100).optional(),
  /** Only messages before this ISO timestamp, to page further back. */
  before: z.string().datetime().optional(),
});

export const sokoBotSearchInboxInputSchema = z.object({
  /** Free-text search (sender, subject, words). Provider search syntax works (e.g. Gmail `from:x newer_than:2d`). */
  query: z.string().max(500).optional(),
  /** Only mail received after this ISO timestamp. */
  since: z.string().datetime().optional(),
  unreadOnly: z.boolean().optional(),
  /** Restrict to one connected provider id; default all email providers. */
  provider: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const sokoBotReadEmailInputSchema = z.object({
  provider: z.string(),
  messageId: z.string(),
});

export const sokoBotListCalendarEventsInputSchema = z.object({
  /** ISO start of the window; default now. */
  from: z.string().datetime().optional(),
  /** ISO end of the window; default 7 days after `from`. */
  to: z.string().datetime().optional(),
  provider: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const sokoBotListIntegrationToolsInputSchema = z.object({
  /** Connected provider id (Composio toolkit slug), e.g. "slack", "notion", "linear". */
  provider: z.string(),
  /** Words from what you want to do; narrows the list. */
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const sokoBotRunIntegrationToolInputSchema = z.object({
  provider: z.string(),
  /** Tool slug exactly as list_integration_tools returned it. */
  tool: z.string(),
  /** Arguments matching the tool's input schema. */
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const SOKO_BOT_TOOL_INPUT_SCHEMAS = {
  list_integration_tools: sokoBotListIntegrationToolsInputSchema,
  run_integration_tool: sokoBotRunIntegrationToolInputSchema,
  list_chats: emptyInputSchema,
  read_chat: sokoBotReadChatInputSchema,
  post_chat: sokoBotPostChatInputSchema,
  list_files: sokoBotListFilesInputSchema,
  upload_file: sokoBotUploadFileInputSchema,
  list_integrations: emptyInputSchema,
  search_inbox: sokoBotSearchInboxInputSchema,
  read_email: sokoBotReadEmailInputSchema,
  list_calendar_events: sokoBotListCalendarEventsInputSchema,
  refresh_context: emptyInputSchema,
  find_coworkers: sokoBotSearchInputSchema,
  create_task: sokoBotCreateTaskInputSchema,
  update_task: sokoBotUpdateTaskInputSchema,
  assign_task: sokoBotAssignTaskInputSchema,
  get_task_status: sokoBotTaskIdInputSchema,
  reply_to_task: sokoBotReplyToTaskInputSchema,
  update_assigned_task: sokoBotUpdateAssignedTaskInputSchema,
  link_tasks: sokoBotLinkTasksInputSchema,
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
} as const satisfies Record<SokoBotCapability, z.ZodType>;

export const SOKO_BOT_TOOL_DESCRIPTIONS = {
  list_integration_tools:
    "What you can do with one of the owner's connected accounts (Slack, Notion, Linear, GitHub, …): tool slugs with descriptions and input schemas. Mailboxes are read through search_inbox/read_email instead.",
  run_integration_tool:
    "Run one tool of a connected account with arguments from its schema. Check the schema with list_integration_tools first; never guess ids. Not available for mailboxes.",
  list_chats:
    "Chat rooms you are a member of: id, name, kind, and when it last had a message. Use this to find the room you need before read_chat.",
  read_chat:
    "Read recent messages in one chat room you are a member of, newest first, with who sent each one. Use it to catch up on a conversation you were added to or mentioned in earlier, or to check what was already said before you answer. You can only read rooms you belong to.",
  post_chat:
    "Post a message into a chat room you are a member of. Use it to answer people in a room you were added to, or to share something you found. It appears as you, immediately, so say only what you can back up.",
  list_files:
    "Files in the owner\u2019s Drive: name, size, type and when each was uploaded. Use it to find an existing document before writing a new one.",
  upload_file:
    "Write a text file into the owner\u2019s Drive (a brief, a summary, notes). Give a filename with an extension; the file appears in their Drive straight away.",
  list_integrations:
    "Which external accounts (Gmail, Outlook, Google Calendar, …) the owner connected to you, and when you last ingested them.",
  search_inbox:
    "Search the owner's connected mailboxes. Returns sender, subject, snippet and ids; use read_email for the full body. Never send mail; you can only read.",
  read_email: "Read one email in full by provider and messageId.",
  list_calendar_events:
    "The owner's calendar events in a time window across connected calendars. Default window: now to +7 days.",
  refresh_context: "Read immutable Context snapshot for current turn.",
  find_coworkers:
    "Find available AI Coworkers suitable for delegated Task work.",
  create_task:
    "Create Sokosumi Task, preferably DRAFT, for Coworker execution.",
  update_task: "Update existing Task scope or DRAFT/READY status.",
  assign_task: "Assign Task to available Coworker and optionally make READY.",
  get_task_status:
    "Read a Task in full: status, assignee, description, the latest events with the Coworker's comments (questions, results, failure reasons), attached files, and linked Tasks.",
  reply_to_task:
    "Post a comment on a Task as the project manager. With status READY it answers a Coworker's INPUT_REQUIRED question or restarts a FAILED task with guidance; without status it only comments.",
  update_assigned_task:
    "Progress a Task that is assigned to you: RUNNING when you start, INPUT_REQUIRED to ask the owner one clear question, COMPLETED with the full result in the comment, FAILED with why. Only for Tasks where you are the assignee.",
  link_tasks:
    "Link two Tasks (related, blocks, blocked_by, parent, child) so follow-up work stays connected on the Taskboard.",
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
} as const satisfies Record<SokoBotCapability, string>;

export function isSokoBotDecisionTarget(
  value: string,
): value is SokoBotDecisionTarget {
  return SOKO_BOT_DECISION_TARGETS.some((target) => target === value);
}

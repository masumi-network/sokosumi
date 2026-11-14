import { TaskStatus } from "@sokosumi/database";
import { redactSokoBotSensitiveText } from "@sokosumi/soko-bot";
import { taskChatMessage } from "@sokosumi/utils";
import { z } from "zod";
import { DAY_MS } from "@/config/constants";
import { SETTLED_TASK_STATUSES } from "@/helpers/task-settled-statuses";
import { memoryRecallResponse } from "./memory-recall-response";

const MAX_QUESTION_LENGTH = 500;
const MAX_LIST_TASKS = 100;
const MAX_SHOWN_TASKS = 10;
const MAX_LABEL_LENGTH = 1_000;
const DAYS_PER_WEEK = 7;
const IDLE_BOARD_QUESTION =
  /^which (?:(?:of )?(my|our) )?open tasks (?:have not moved|have been idle|have been inactive) for (?:more than|over) (a|one|[1-9]\d{0,2}) (day|week)s?(?:,? and who (?:has|owns) each(?: one)?)?\??$/i;
const openStatus = z
  .enum(TaskStatus)
  .refine(
    (status) =>
      status !== TaskStatus.CREATED &&
      !SETTLED_TASK_STATUSES.some((settled) => status === settled),
  );
const boardRead = z.object({
  capability: z.literal("list_tasks"),
  status: z.literal("COMPLETED"),
  createdAt: z.date(),
  input: z
    .object({
      state: z.literal("open").optional(),
      limit: z.number().int().min(1).max(MAX_LIST_TASKS).optional(),
      idleDays: z.number().int().nonnegative().optional(),
    })
    .strict(),
  result: z.object({
    tasks: z
      .array(
        z.object({
          id: z.uuid(),
          name: z.string().min(1).max(MAX_LABEL_LENGTH),
          owner: z.string(),
          status: openStatus,
          updatedAt: z.string().datetime({ offset: true }),
          assignee: z
            .object({ name: z.string().min(1).max(MAX_LABEL_LENGTH) })
            .nullable(),
        }),
      )
      .max(MAX_LIST_TASKS),
    total: z.number().int().nonnegative(),
    truncated: z.literal(false).optional(),
    _truncated: z.literal(false).optional(),
  }),
});
const boardSource = z.object({
  source: z.literal("CHAT"),
  route: z.literal("DIRECT_RESPONSE"),
  userMessage: z.string().max(MAX_QUESTION_LENGTH),
  contextSnapshot: z.object({
    packet: z.object({
      trigger: z.object({
        source: z.literal("CHAT"),
        route: z.literal("DIRECT_RESPONSE"),
        askedBy: z.object({ kind: z.literal("OWNER") }),
      }),
    }),
  }),
  toolCalls: z.array(boardRead).length(1),
});

/** A complete authorized board read can answer a narrowly understood idle question. */
function idleBoardResponse(source: unknown): string | null {
  const parsed = boardSource.safeParse(source);
  if (!parsed.success || /[\r\n]/.test(parsed.data.userMessage)) return null;
  const question = parsed.data.userMessage.trim().match(IDLE_BOARD_QUESTION);
  if (!question) return null;
  const days =
    (question[2].toLowerCase() === "a" || question[2].toLowerCase() === "one"
      ? 1
      : Number(question[2])) *
    (question[3].toLowerCase() === "week" ? DAYS_PER_WEEK : 1);
  const read = parsed.data.toolCalls[0];
  const { tasks, total } = read.result;
  if (
    total !== tasks.length ||
    new Set(tasks.map((task) => task.id)).size !== tasks.length ||
    (read.input.idleDays ?? 0) > days
  )
    return null;
  const ownOnly = question[1]?.toLowerCase() === "my";
  const threshold = read.createdAt.getTime() - days * DAY_MS;
  const matching = tasks.filter(
    (task) =>
      (!ownOnly || task.owner === "your owner") &&
      Date.parse(task.updatedAt) < threshold,
  );
  const unit = question[3].toLowerCase();
  const amount = days / (unit === "week" ? DAYS_PER_WEEK : 1);
  const period = `${amount} ${unit}${amount === 1 ? "" : "s"}`;
  const whose = ownOnly ? "your" : "the";
  if (!matching.length)
    return `None of ${whose} open Tasks has been idle for more than ${period}.`;
  const safeText = (value: string) =>
    redactSokoBotSensitiveText(value.replace(/[\r\n]+/g, " "));
  return [
    `${matching.length} of ${whose} open Tasks had no update for more than ${period}:`,
    ...matching
      .slice(0, MAX_SHOWN_TASKS)
      .map(
        (task) =>
          `- ${taskChatMessage({ ...task, name: safeText(task.name), identifier: null }, "")}: ${task.assignee ? `assigned to ${JSON.stringify(safeText(task.assignee.name))}` : "unassigned"}. Last update: ${task.updatedAt}.`,
      ),
    ...(matching.length > MAX_SHOWN_TASKS
      ? [
          `Showing the first ${MAX_SHOWN_TASKS} of ${matching.length} matching Tasks.`,
        ]
      : []),
  ].join("\n");
}

/** Rebuild a fact-only reply; never restore the rejected model narrative. */
export function readAnswerResponse(source: unknown): string | null {
  return memoryRecallResponse(source) ?? idleBoardResponse(source);
}

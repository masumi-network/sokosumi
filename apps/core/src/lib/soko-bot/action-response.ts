import type { Prisma } from "@sokosumi/database";
import { isSokoBotSilentAnswer } from "@sokosumi/soko-bot";
import { z } from "zod";
import { sokoBotOutcomeSummary } from "@/services/soko-bot-outcome.service";

import {
  ACTION_CAPABILITIES,
  verifyTaskArchiveReceipt,
} from "./action-receipts";

const ACTION_LABELS: Record<string, string> = {
  manage_reminder: "Updated reminder",
  create_task: "Created task",
  create_table: "Created table",
  write_table_rows: "Updated table rows",
  update_table_columns: "Updated table columns",
  update_task: "Updated task",
  archive_task: "Archived task",
  assign_task: "Assigned task",
  reply_to_task: "Added a task comment",
  update_assigned_task: "Updated assigned task",
  link_tasks: "Linked tasks",
  post_chat: "Queued chat message",
  open_direct_chat: "Queued direct message",
  create_schedule: "Configured schedule",
  update_schedule: "Updated schedule",
  delete_schedule: "Deleted schedule",
  update_memory: "Updated memory",
  hire_agent: "Hired agent",
  provide_job_input: "Submitted job input",
  run_integration_tool: "Integration acknowledged operation",
  upload_file: "Uploaded file",
};

const QUESTIONS = {
  TARGET: "Which task or item do you mean?",
  SCOPE: "What should I change, and what should stay as it is?",
  TIME: "When should this happen? Please include your time zone.",
  APPROVAL: "Please approve the pending decision before I continue.",
  DETAILS: "What additional details should I use?",
} as const;

export const actionNarrativeSchema = z
  .object({
    kind: z.enum(["REPORT", "CLARIFY", "SILENT"]),
    question: z
      .enum(["TARGET", "SCOPE", "TIME", "APPROVAL", "DETAILS"])
      .nullable(),
    observationToolCallIds: z.array(z.string()).max(8),
  })
  .strict();

export function parseActionNarrative(value: unknown) {
  const parsed = actionNarrativeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseActionNarrativeText(text: string) {
  try {
    return parseActionNarrative(JSON.parse(text));
  } catch {
    return null;
  }
}

// These are persisted authorized read fields, not model-authored narration.
const readObservationSchema = z.object({
  id: z.string().optional(),
  name: z.string().nullable().optional(),
  status: z.string().optional(),
  project: z.object({ name: z.string() }).nullable().optional(),
  assignee: z.object({ name: z.string().nullable() }).nullable().optional(),
  events: z
    .array(
      z.object({
        status: z.string().nullable().optional(),
        comment: z.string().nullable().optional(),
        by: z.string().optional(),
        inputSchema: z.unknown().optional(),
      }),
    )
    .optional(),
  fulfillment: z
    .object({
      state: z.enum([
        "UNKNOWN",
        "IN_PROGRESS",
        "FULFILLED",
        "PARTIAL",
        "BLOCKED",
        "FAILED",
        "CANCELLED",
      ]),
      blockerKind: z.string().nullable(),
      remainingSteps: z.array(z.string()),
      acceptanceCriteria: z
        .array(z.object({ id: z.string(), description: z.string().optional() }))
        .optional(),
    })
    .optional(),
  links: z
    .array(
      z.object({
        relation: z.string(),
        direction: z.string(),
        note: z.string().nullable().optional(),
        task: z.object({ name: z.string(), status: z.string() }),
      }),
    )
    .optional(),
});

function quoteRead(value: string) {
  return JSON.stringify(value.slice(0, 600));
}

function describeRead(capability: string, value: unknown): string[] {
  const parsed = readObservationSchema.safeParse(value);
  if (!parsed.success) return [];
  const read = parsed.data;
  const isTask = capability === "get_task_status";
  const event = isTask ? read.events?.at(-1) : read.events?.[0];
  const status = read.status ?? event?.status;
  const observations: string[] = [];
  if (read.name && status)
    observations.push(
      `Observed ${isTask ? "task" : "job"} ${quoteRead(read.name)}: status ${quoteRead(status)}.`,
    );
  if (read.project)
    observations.push(`Recorded project: ${quoteRead(read.project.name)}.`);
  if (read.assignee?.name)
    observations.push(`Recorded assignee: ${quoteRead(read.assignee.name)}.`);
  if (event?.comment)
    observations.push(
      `Latest reported task update (${quoteRead(event.by ?? "unknown author")}): ${quoteRead(event.comment)}.`,
    );
  if (!isTask && status === "AWAITING_INPUT")
    observations.push(
      "The latest job event is awaiting input; completion is not verified.",
    );
  if (read.fulfillment) {
    const summary = sokoBotOutcomeSummary(read.fulfillment);
    if (summary) observations.push(`Recorded outcome assessment: ${summary}`);
    for (const id of read.fulfillment.remainingSteps.slice(0, 4)) {
      const criterion = read.fulfillment.acceptanceCriteria?.find(
        (item) => item.id === id,
      );
      observations.push(
        `Still unverified: ${quoteRead(criterion?.description ?? id)}.`,
      );
    }
  }
  for (const link of (read.links ?? []).slice(0, 4))
    observations.push(
      `Recorded task relationship ${quoteRead(link.relation)} (${quoteRead(link.direction)}): ${quoteRead(link.task.name)}, status ${quoteRead(link.task.status)}.${link.note ? ` Reported note: ${quoteRead(link.note)}.` : ""}`,
    );
  return observations;
}

/** Model text cannot confer evidence. Replays reference original committed proof. */
export async function buildActionResponse(
  tx: Prisma.TransactionClient,
  turnId: string,
  answerText: string,
  actionRequested = false,
  narrativeInput?: unknown,
) {
  const calls = await tx.sokoBotToolCall.findMany({
    where: { turnId, capability: { in: [...ACTION_CAPABILITIES] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const replayIds = calls.flatMap((call) =>
    call.replayedReceiptId ? [call.replayedReceiptId] : [],
  );
  const turn = replayIds.length
    ? await tx.sokoBotTurn.findUnique({
        where: { id: turnId },
        select: {
          sokoBotId: true,
          workspaceId: true,
          intentId: true,
          intentRevision: true,
        },
      })
    : null;
  const prior = turn
    ? await tx.sokoBotToolCall.findMany({
        where: {
          id: { in: replayIds },
          actorBotId: turn.sokoBotId,
          turn: {
            sokoBotId: turn.sokoBotId,
            workspaceId: turn.workspaceId,
            ...(turn.intentId
              ? { intentId: turn.intentId, intentRevision: turn.intentRevision }
              : { id: turnId }),
          },
        },
      })
    : [];
  const linkedPrior = prior.filter((source) =>
    calls.some(
      (call) =>
        call.replayedReceiptId === source.id &&
        source.capability === call.capability &&
        source.inputHash === call.inputHash,
    ),
  );
  const verified = [...calls, ...linkedPrior].filter(
    (call) =>
      call.status === "COMPLETED" &&
      (call.disposition === "APPLIED" ||
        call.disposition === "ALREADY_SATISFIED") &&
      call.verification !== "NONE" &&
      call.committedAt &&
      call.targetId,
  );
  const current = [];
  for (const call of verified) {
    if (
      call.capability !== "archive_task" ||
      (await verifyTaskArchiveReceipt(tx, call.id))
    )
      current.push(call);
  }
  const unique = [...new Map(current.map((call) => [call.id, call])).values()];
  const appliedReceiptIds = unique.map((call) => call.id);
  const unfulfilledActions = calls
    .filter(
      (call) =>
        !appliedReceiptIds.includes(call.id) &&
        !(
          call.replayedReceiptId &&
          prior.some(
            (source) =>
              source.id === call.replayedReceiptId &&
              appliedReceiptIds.includes(source.id) &&
              source.capability === call.capability &&
              source.inputHash === call.inputHash,
          )
        ),
    )
    .map((call) => ({
      action: call.capability,
      receiptId: call.id,
      reason: call.disposition === "UNKNOWN" ? "UNKNOWN" : "NOT_VERIFIED",
    }));
  const actionText = unique.map(
    (call) =>
      `${call.turnId !== turnId ? "Previously verified: " : ""}${call.disposition === "ALREADY_SATISFIED" ? "Already satisfied" : ACTION_LABELS[call.capability]} (${call.capability === "create_table" ? `[Open table](/drive/tables/${encodeURIComponent(call.targetId ?? "")})` : call.targetId}).`,
  );
  for (const action of unfulfilledActions) {
    actionText.push(
      action.reason === "UNKNOWN"
        ? `The outcome of ${action.action} is unknown. Reconciliation is required before retrying.`
        : `I could not verify ${action.action}.`,
    );
  }
  const narrative =
    parseActionNarrative(narrativeInput) ??
    parseActionNarrativeText(answerText);
  const observations: string[] = [];
  if (narrative?.observationToolCallIds.length) {
    const reads = await tx.sokoBotToolCall.findMany({
      where: {
        turnId,
        toolCallId: { in: narrative.observationToolCallIds },
        capability: { in: ["get_task_status", "get_job_status"] },
        status: "COMPLETED",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const read of reads) {
      observations.push(...describeRead(read.capability, read.result));
    }
  }
  const question =
    narrative?.kind === "CLARIFY" && narrative.question
      ? QUESTIONS[narrative.question]
      : null;
  const narrativeText = [...observations, ...(question ? [question] : [])];
  const silent =
    !calls.length &&
    (narrative?.kind === "SILENT" || isSokoBotSilentAnswer(answerText));
  return {
    appliedReceiptIds,
    narrative,
    observations,
    unfulfilledActions,
    answerText: silent
      ? "Nothing to add."
      : calls.length || narrativeText.length
        ? [...actionText, ...narrativeText].join("\n")
        : actionRequested
          ? "No action was verified. Please specify the target and change you want."
          : answerText,
  };
}

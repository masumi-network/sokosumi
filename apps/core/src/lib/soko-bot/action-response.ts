import type { Prisma } from "@sokosumi/database";
import { getSokoBotVersion, isSokoBotSilentAnswer } from "@sokosumi/soko-bot";
import { z } from "zod";
import { cursorPaginationMetaSchema } from "@/schemas/pagination.schema";

import {
  ACTION_CAPABILITIES,
  verifyTaskArchiveReceipt,
} from "./action-receipts";

/** Turns an owner asked for; the rest the bot started itself. */
const OWNER_STARTED_SOURCES = new Set(["CHAT", "ADMIN_RETRY"]);

/** Shown when the claim check could not run; meant for someone who asked. */
export const HELD_BACK_REPLY =
  "I held back this reply because it could not be checked just now.";

export const ACTION_LABELS: Record<string, string> = {
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
  generate_image: "Started image",
  create_social_post: "Created social post",
  update_social_post: "Updated social post",
  schedule_social_post: "Scheduled social post",
  cancel_social_post: "Canceled social post",
  publish_social_post: "Published social post",
};

/** A comment that also changed the status says which change it was. */
function actionLabel(call: { capability: string; result?: unknown }): string {
  const reply = z
    .object({ statusChanged: z.literal(true), status: z.string() })
    .safeParse(call.result);
  if (call.capability === "reply_to_task" && reply.success)
    return reply.data.status === "CANCELED" ? "Canceled task" : "Resumed task";
  if (
    call.capability === "upload_file" &&
    z.object({ replaced: z.literal(true) }).safeParse(call.result).success
  )
    return "Updated file";
  return ACTION_LABELS[call.capability] ?? call.capability;
}

const TABLE_CAPABILITIES = new Set([
  "create_table",
  "write_table_rows",
  "update_table_columns",
]);

const SOCIAL_POST_CAPABILITIES = new Set([
  "create_social_post",
  "update_social_post",
  "schedule_social_post",
  "cancel_social_post",
  "publish_social_post",
]);

const TASK_TARGET_CAPABILITIES = new Set([
  "create_task",
  "update_task",
  "archive_task",
  "assign_task",
  "reply_to_task",
  "update_assigned_task",
]);

interface TaskLabel {
  name: string;
  assignee: string | null;
}

/** Names come from the stored task, never from the model's narration. */
async function taskLabels(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<Map<string, TaskLabel>> {
  if (!ids.length) return new Map();
  const tasks = await tx.task.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: {
      id: true,
      name: true,
      assignee: { select: { name: true } },
      assigneeUser: { select: { name: true } },
      assigneeSokoBot: { select: { name: true } },
    },
  });
  return new Map(
    tasks.map((task) => [
      task.id,
      {
        name: task.name,
        assignee:
          task.assignee?.name ??
          task.assigneeUser?.name ??
          task.assigneeSokoBot?.name ??
          null,
      },
    ]),
  );
}

/** Literal text inside markdown: a Task called "[TEST] Launch" keeps its brackets. */
function linkText(value: string): string {
  return value.slice(0, 120).replace(/[[\]\\]/g, "\\$&");
}

function actionTarget(
  call: { capability: string; targetId: string | null; result?: unknown },
  tasks: Map<string, TaskLabel>,
  jobAgents: Map<string, string>,
  assignedTaskIds: ReadonlySet<string | null>,
): string {
  const id = call.targetId ?? "";
  if (TABLE_CAPABILITIES.has(call.capability))
    return `([Open table](/drive/tables/${encodeURIComponent(id)}))`;
  if (SOCIAL_POST_CAPABILITIES.has(call.capability)) {
    const post = z
      .object({ projectId: z.string().min(1) })
      .safeParse(call.result);
    return post.success
      ? `([Open post](/social?projectId=${encodeURIComponent(post.data.projectId)}&postId=${encodeURIComponent(id)}))`
      : "";
  }
  if (call.capability === "generate_image") {
    const studio = z
      .object({ studioUrl: z.string().startsWith("/studio?") })
      .safeParse(call.result);
    if (studio.success)
      return `([Open in Content Studio](${studio.data.studioUrl}))`;
  }
  if (call.capability === "upload_file") {
    const file = z
      .object({ filename: z.string().min(1) })
      .safeParse(call.result);
    if (!file.success) return "";
    // Older receipts hold the blob URL and get their card from the line below.
    return id.startsWith("https://")
      ? linkText(file.data.filename)
      : `[${linkText(file.data.filename)}](/drive/files/${encodeURIComponent(id)})`;
  }
  if (call.capability === "hire_agent") {
    const agentId = jobAgents.get(id);
    return agentId
      ? `([Open job](/agents/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(id)}))`
      : "";
  }
  const task = tasks.get(id);
  // Anything else is named by its label alone: a raw id tells the owner
  // nothing.
  if (!task) return "";
  const link = `[${linkText(task.name)}](/tasks/${encodeURIComponent(id)})`;
  // Who got it is half of what the owner asked for. A Task created with its
  // assignee says so on the create line; one assigned afterwards on its own.
  const namesAssignee =
    call.capability === "assign_task" ||
    (call.capability === "create_task" && !assignedTaskIds.has(id));
  return namesAssignee && task.assignee
    ? `${link} → ${linkText(task.assignee)}`
    : link;
}

/** Names are listed up to this many; past it a count says enough. */
const MAX_NAMED_TARGETS = 5;

/**
 * What the owner asked for on a Task, said as not done ("Couldn't archive …")
 * or, when it ran but left no proof, as unconfirmed ("Couldn't confirm I
 * archived …").
 */
const UNDONE_TASK_VERBS: Record<string, [string, string]> = {
  create_task: ["create", "created"],
  update_task: ["update", "updated"],
  archive_task: ["archive", "archived"],
  assign_task: ["assign", "assigned"],
  reply_to_task: ["comment on", "commented on"],
  update_assigned_task: ["update", "updated"],
};

/** The target a call was aimed at, even one refused before it had a receipt. */
function attemptedTarget(call: {
  targetId: string | null;
  input?: unknown;
}): string | null {
  return (
    call.targetId ??
    z.object({ taskId: z.string().min(1) }).safeParse(call.input).data
      ?.taskId ??
    null
  );
}

/** "a Task", one linked Task, or a count that names a few. */
function missedTasks(links: string[]): string {
  if (links.length === 1) return links[0] || "a Task";
  const label = `${links.length} Tasks`;
  return links.every(Boolean) && links.length <= MAX_NAMED_TARGETS
    ? `${label}: ${links.join(", ")}`
    : label;
}

/** "Archived task" ×4 → "Archived 4 Tasks"; other labels keep a count. */
function countedLabel(label: string, count: number): string {
  if (count === 1) return label;
  const task = /^(.*) task$/i.exec(label);
  return task ? `${task[1]} ${count} Tasks` : `${label} (${count}×)`;
}

function collapseActionLines(
  lines: { head: string; target: string }[],
): string[] {
  const groups = new Map<string, string[]>();
  for (const { head, target } of lines) {
    const targets = groups.get(head) ?? [];
    if (!targets.includes(target)) targets.push(target);
    groups.set(head, targets);
  }
  return [...groups].map(([head, targets]) => {
    if (targets.length === 1)
      return `${[head, targets[0]].filter(Boolean).join(" ")}.`;
    const named = targets.filter(Boolean);
    const label = countedLabel(head, targets.length);
    return named.length && targets.length <= MAX_NAMED_TARGETS
      ? `${label}: ${named.join(", ")}.`
      : `${label}.`;
  });
}

const QUESTIONS = {
  TARGET: "Which task or item do you mean?",
  SCOPE: "What should I change, and what should stay as it is?",
  TIME: "When should this happen? Please include your time zone.",
  APPROVAL: "Should I go ahead?",
  DETAILS: "What additional details should I use?",
} as const;

export const actionNarrativeSchema = z
  .object({
    kind: z.enum(["REPORT", "CLARIFY", "SILENT"]),
    /** The bot's own words; action lines never come from here. */
    message: z.string().trim().max(8_000).nullable().optional(),
    question: z
      .enum(["TARGET", "SCOPE", "TIME", "APPROVAL", "DETAILS"])
      .nullable(),
    observationToolCallIds: z.array(z.string()).max(8),
  })
  .strict();

export type ActionNarrative = z.infer<typeof actionNarrativeSchema>;

export function parseActionNarrative(value: unknown) {
  const parsed = actionNarrativeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Accepts the object on its own, fenced as ```json, or wrapped in prose. */
export function parseActionNarrativeText(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return parseActionNarrative(JSON.parse(text.slice(start, end + 1)));
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

const socialAccountObservationSchema = z.object({
  id: z.string(),
  provider: z.string(),
  externalHandle: z.string().nullable(),
  status: z.string(),
  connectedAt: z.string().nullable(),
  disconnectedAt: z.string().nullable(),
});

const socialPostObservationSchema = z.object({
  id: z.string(),
  provider: z.string(),
  text: z.string(),
  status: z.string(),
  revision: z.number().int().nonnegative(),
  scheduledAt: z.string().nullable(),
  timezone: z.string().nullable(),
  publishedUrl: z.string().nullable(),
  socialConnection: z
    .object({ externalHandle: z.string().nullable(), status: z.string() })
    .nullable()
    .optional(),
});

function describeSocialPost(read: z.infer<typeof socialPostObservationSchema>) {
  return `Observed social post ${quoteRead(read.id)}: platform ${quoteRead(read.provider)}, status ${quoteRead(read.status)}, revision ${read.revision}. Text: ${quoteRead(read.text)}. Scheduled at: ${quoteRead(read.scheduledAt ?? "not scheduled")}; time zone: ${quoteRead(read.timezone ?? "not set")}.${read.socialConnection ? ` Account: ${quoteRead(read.socialConnection.externalHandle ?? "unknown handle")}, status ${quoteRead(read.socialConnection.status)}.` : ""}${read.publishedUrl ? ` Published URL: ${quoteRead(read.publishedUrl)}.` : ""}`;
}

function describeRead(capability: string, value: unknown): string[] {
  if (capability === "list_project_social_accounts") {
    const parsed = z.array(socialAccountObservationSchema).safeParse(value);
    if (!parsed.success) return [];
    return [
      `Showing ${parsed.data.length} of ${parsed.data.length} returned social accounts.`,
      ...parsed.data.map(
        (read) =>
          `Observed social account ${quoteRead(read.id)}: platform ${quoteRead(read.provider)}, handle ${quoteRead(read.externalHandle ?? "unknown handle")}, status ${quoteRead(read.status)}. Connected at: ${quoteRead(read.connectedAt ?? "not recorded")}; disconnected at: ${quoteRead(read.disconnectedAt ?? "not recorded")}.`,
      ),
    ];
  }
  if (capability === "list_social_posts") {
    const parsed = z
      .object({
        posts: z.array(socialPostObservationSchema),
        pagination: cursorPaginationMetaSchema,
      })
      .safeParse(value);
    if (!parsed.success) return [];
    return [
      `Showing ${Math.min(parsed.data.posts.length, 5)} of ${parsed.data.posts.length} returned social posts (${parsed.data.pagination.total} total).${parsed.data.pagination.nextCursor ? " More posts are available." : ""}`,
      ...parsed.data.posts.slice(0, 5).map(describeSocialPost),
    ];
  }
  if (capability === "get_social_post") {
    const parsed = socialPostObservationSchema.safeParse(value);
    return parsed.success ? [describeSocialPost(parsed.data)] : [];
  }
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
    for (const id of read.fulfillment.remainingSteps.slice(0, 4)) {
      const criterion = read.fulfillment.acceptanceCriteria?.find(
        (item) => item.id === id,
      );
      observations.push(
        `Not confirmed yet: ${quoteRead(criterion?.description ?? id)}.`,
      );
    }
  }
  for (const link of (read.links ?? []).slice(0, 4))
    observations.push(
      `Recorded task relationship ${quoteRead(link.relation)} (${quoteRead(link.direction)}): ${quoteRead(link.task.name)}, status ${quoteRead(link.task.status)}.${link.note ? ` Reported note: ${quoteRead(link.note)}.` : ""}`,
    );
  return observations;
}

/** Whether `later` repeats every field `earlier` set, with the same value. */
function inputCovers(later: unknown, earlier: unknown): boolean {
  if (!isPlainObject(later) || !isPlainObject(earlier)) return false;
  return Object.entries(earlier).every(
    ([key, value]) => JSON.stringify(later[key]) === JSON.stringify(value),
  );
}

/** Whether a Cuso turn filed its report as a chat card (report_update). */
async function cmoReportedByCard(
  tx: Prisma.TransactionClient,
  turnId: string,
  cmo: boolean,
): Promise<boolean> {
  if (!cmo) return false;
  const reports = await tx.sokoBotToolCall.count({
    where: { turnId, capability: "report_update", status: "COMPLETED" },
  });
  return reports > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  // A refused attempt the bot then made good — the same call on the same
  // target, or again with the missing fields filled in — is not something the
  // owner needs to hear about. One whose outcome is unknown always is.
  const madeGood = (call: (typeof calls)[number]) =>
    call.disposition !== "UNKNOWN" &&
    unique.some(
      (applied) =>
        applied.turnId === turnId &&
        applied.capability === call.capability &&
        applied.createdAt > call.createdAt &&
        ((call.targetId !== null && applied.targetId === call.targetId) ||
          inputCovers(applied.input, call.input)),
    );
  const unfulfilledActions = calls
    .filter(
      (call) =>
        !appliedReceiptIds.includes(call.id) &&
        !madeGood(call) &&
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
  const unfulfilledTargets = new Map(
    calls.map((call) => [call.id, attemptedTarget(call)]),
  );
  const tasks = await taskLabels(tx, [
    ...unique.flatMap((call) =>
      TASK_TARGET_CAPABILITIES.has(call.capability) && call.targetId
        ? [call.targetId]
        : [],
    ),
    ...unfulfilledActions.flatMap((action) => {
      const target = unfulfilledTargets.get(action.receiptId);
      return TASK_TARGET_CAPABILITIES.has(action.action) && target
        ? [target]
        : [];
    }),
  ]);
  const hiredJobIds = unique.flatMap((call) =>
    call.capability === "hire_agent" && call.targetId ? [call.targetId] : [],
  );
  const jobAgents = new Map(
    hiredJobIds.length
      ? (
          await tx.job.findMany({
            where: { id: { in: hiredJobIds } },
            select: { id: true, agentId: true },
          })
        ).map((job) => [job.id, job.agentId])
      : [],
  );
  const assignedTaskIds = new Set(
    unique
      .filter((call) => call.capability === "assign_task")
      .map((call) => call.targetId),
  );
  // One line per kind of effect: a hire recorded twice, or one Task reached
  // two ways, is still one thing done, and thirteen archives are one line.
  const receiptLines = collapseActionLines(
    unique.map((call) => ({
      head: `${call.turnId !== turnId ? "Previously verified: " : ""}${
        call.disposition === "ALREADY_SATISFIED"
          ? "Already satisfied"
          : actionLabel(call)
      }`,
      target: actionTarget(call, tasks, jobAgents, assignedTaskIds),
    })),
  );
  // Cuso reports through a card in the founder's chat. Once he filed one this
  // turn, the receipts repeat the card; only refusals and unknowns, which the
  // card does not carry, still follow as lines.
  // One read of the turn serves every question about it below.
  let turnRow:
    | Promise<{ source: string | null; versionId: string | null } | null>
    | undefined;
  const turnInfo = () => {
    turnRow ??= tx.sokoBotTurn.findUnique({
      where: { id: turnId },
      select: { source: true, versionId: true },
    });
    return turnRow;
  };
  const isCmo = async () =>
    getSokoBotVersion((await turnInfo())?.versionId).profile === "cmo";
  const reportedByCard = await cmoReportedByCard(tx, turnId, await isCmo());
  const actionText: string[] = reportedByCard ? [] : receiptLines;
  // A file link on its own line renders as the file's card in chat.
  const attachments = [
    ...new Set(
      unique.flatMap((call) => {
        const file = z
          .object({ filename: z.string().min(1) })
          .safeParse(call.result);
        return call.capability === "upload_file" &&
          call.targetId?.startsWith("https://") &&
          file.success
          ? [`[${linkText(file.data.filename)}](${call.targetId})`]
          : [];
      }),
    ),
  ];
  // A refused attempt matters to an owner who asked for it. On a turn the bot
  // started itself nobody did, and "Not confirmed: …" read as a failure notice
  // at the top of a morning update. An unknown outcome is always said.
  let ownerStarted: boolean | undefined;
  const isOwnerStarted = async () => {
    ownerStarted ??= await turnInfo().then(
      (row) => !row?.source || OWNER_STARTED_SOURCES.has(row.source),
    );
    return ownerStarted;
  };
  const ownerAsked = unfulfilledActions.some(
    (action) => action.reason !== "UNKNOWN",
  )
    ? await isOwnerStarted()
    : true;
  // One line per kind of miss, counting each target once: a model that
  // retried an archive three times still missed one Task, not three.
  const ranIds = new Set(
    calls.filter((call) => call.status === "COMPLETED").map((call) => call.id),
  );
  const unfulfilledGroups = new Map<
    string,
    { reason: string; action: string; ran: boolean; targets: Set<string> }
  >();
  for (const action of unfulfilledActions) {
    if (action.reason !== "UNKNOWN" && !ownerAsked) continue;
    const didRun = ranIds.has(action.receiptId);
    const key = `${action.reason}:${didRun}:${action.action}`;
    const group = unfulfilledGroups.get(key) ?? {
      reason: action.reason,
      action: action.action,
      ran: didRun,
      targets: new Set<string>(),
    };
    group.targets.add(
      unfulfilledTargets.get(action.receiptId) ?? action.receiptId,
    );
    unfulfilledGroups.set(key, group);
  }
  for (const { reason, action, ran, targets } of unfulfilledGroups.values()) {
    const label = countedLabel(
      (ACTION_LABELS[action] ?? action).toLowerCase(),
      targets.size,
    );
    const verbs = UNDONE_TASK_VERBS[action];
    const what = () =>
      missedTasks(
        [...targets].map((id) =>
          actionTarget(
            { capability: action, targetId: id },
            tasks,
            jobAgents,
            assignedTaskIds,
          ),
        ),
      );
    actionText.push(
      reason === "UNKNOWN"
        ? `I couldn't confirm whether this went through: ${label}. Check before trying again.`
        : !verbs
          ? `Not confirmed: ${label}.`
          : ran
            ? `Couldn't confirm I ${verbs[1]} ${what()}.`
            : `Couldn't ${verbs[0]} ${what()}.`,
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
        capability: {
          in: [
            "get_task_status",
            "get_job_status",
            "list_project_social_accounts",
            "list_social_posts",
            "get_social_post",
          ],
        },
        status: "COMPLETED",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const read of reads) {
      observations.push(...describeRead(read.capability, read.result));
    }
  }
  // A turn the bot started itself has nobody waiting on a held-back reply.
  const message =
    narrative?.message === HELD_BACK_REPLY && !(await isOwnerStarted())
      ? null
      : narrative?.message || null;
  const question =
    !message && narrative?.kind === "CLARIFY" && narrative.question
      ? QUESTIONS[narrative.question]
      : null;
  // Observations restate reads in fixed wording; the bot's own message says
  // the same in plain words, so they are shown only when it wrote none. A
  // CMO bot (Cuso) never shows them: its reports are cards in the founder's
  // chat, and raw ids and statuses there read as a leak.
  const showObservations =
    !message && observations.length > 0 && !(await isCmo());
  const narrativeText = message
    ? [message]
    : actionText.length
      ? question
        ? [question]
        : []
      : [
          ...(showObservations ? observations : []),
          ...(question ? [question] : []),
        ];
  // On a turn nobody asked for, "nothing changed" is not news: the turn ends
  // silent like "Nothing to add." instead of posting a placeholder.
  const nothingToSay =
    !calls.length && !narrativeText.length && !actionText.length;
  const silent =
    !calls.length &&
    (narrative?.kind === "SILENT" ||
      isSokoBotSilentAnswer(answerText) ||
      (actionRequested && nothingToSay && !(await isOwnerStarted())));
  return {
    appliedReceiptIds,
    narrative,
    observations,
    unfulfilledActions,
    answerText: silent
      ? "Nothing to add."
      : calls.length || narrativeText.length
        ? [
            actionText.join("\n"),
            reportedByCard ? "" : attachments.join("\n"),
            narrativeText.join("\n"),
          ]
            .filter(Boolean)
            .join("\n\n") || "Nothing to add."
        : actionRequested
          ? "Nothing was changed in this turn."
          : answerText,
  };
}

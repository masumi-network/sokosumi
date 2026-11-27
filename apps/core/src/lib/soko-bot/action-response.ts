import type { Prisma } from "@sokosumi/database";
import {
  ACTION_LABELS,
  getSokoBotVersion,
  isSokoBotSilentAnswer,
} from "@sokosumi/soko-bot";
import { withoutSokosumiLinks } from "@sokosumi/utils";
import { z } from "zod";
import { getWebAppBaseUrl } from "@/config/env";
import { cursorPaginationMetaSchema } from "@/schemas/pagination.schema";
import {
  ACCOUNT_QUESTION_HEADING,
  showAccountQuestion,
} from "./account-question";
import {
  ACTION_CAPABILITIES,
  ACTION_RECEIPT_CAPABILITIES,
  verifyTaskArchiveReceipt,
} from "./action-receipts";
import {
  actionLabel,
  actionTarget,
  attemptedTarget,
  collapseActionLines,
  countedLabel,
  linkText,
  missedTasks,
  seoTaskLabels,
  TASK_TARGET_CAPABILITIES,
  taskLabels,
  UNDONE_TASK_VERBS,
} from "./action-response-targets";
import { linkCalendarContacts } from "./calendar-contact-links";

/** Turns an owner asked for; the rest the bot started itself. */
const OWNER_STARTED_SOURCES = new Set(["CHAT", "ADMIN_RETRY"]);

/** Shown when the claim check could not run; meant for someone who asked. */
export const HELD_BACK_REPLY =
  "I held back this reply because it could not be checked just now.";

const QUESTIONS = {
  TARGET: "Which task or item do you mean?",
  SCOPE: "What should I change, and what should stay as it is?",
  TIME: "When should this happen? Please include your time zone.",
  APPROVAL: "Should I go ahead?",
  DETAILS: "What additional details should I use?",
} as const;

const MAX_OBSERVATIONS = 8;

export const actionNarrativeSchema = z
  .object({
    kind: z.enum(["REPORT", "CLARIFY", "SILENT"]),
    /** The bot's own words; action lines never come from here. */
    message: z.string().trim().max(8_000).nullable().optional(),
    question: z
      .enum(["TARGET", "SCOPE", "TIME", "APPROVAL", "DETAILS"])
      .nullable(),
    // A weekly wrap reads a dozen Tasks; rejecting the extra ids would post
    // the raw JSON instead of the message.
    observationToolCallIds: z
      .array(z.string())
      .transform((ids) => ids.slice(0, MAX_OBSERVATIONS)),
    /**
     * Set by Core, never the model: the claim check could not run, or cut
     * a sentence. The answer then says so beside the message.
     */
    replyCheck: z.enum(["unchecked", "cut"]).optional(),
  })
  .strict();

/** Shown under the bot's words when Core left part of them out. */
export const REPLY_CHECK_NOTES = {
  unchecked:
    "(I could not check this reply against my records just now, so I left out anything it said was done that my records do not show.)",
  cut: "(I left out a line about a change my records do not show.)",
} as const;

export type ActionNarrative = z.infer<typeof actionNarrativeSchema>;

const ACCOUNT_QUESTION_BLOCK = new RegExp(
  `\\n\\n${ACCOUNT_QUESTION_HEADING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\n\\d+\\. [^\\n]+)+$`,
);

/** The answer without the account question Core added at its end, if any. */
function withoutAccountQuestionBlock(text: string): string {
  return text.replace(ACCOUNT_QUESTION_BLOCK, "");
}

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
    const parsed = parseActionNarrative(JSON.parse(text.slice(start, end + 1)));
    if (!parsed) return null;
    // Only Core says that it checked the reply.
    const { replyCheck: _fromModel, ...narrative } = parsed;
    return narrative;
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
  // Absent from tool calls stored before accounts carried limits.
  textLimit: z.number().int().optional(),
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
  threadPartCount: z.number().int().optional(),
  quotedPostId: z.string().nullable().optional(),
});

function describeSocialPost(read: z.infer<typeof socialPostObservationSchema>) {
  return `Observed social post ${quoteRead(read.id)}: platform ${quoteRead(read.provider)}, status ${quoteRead(read.status)}, revision ${read.revision}. Text: ${quoteRead(read.text)}. Scheduled at: ${quoteRead(read.scheduledAt ?? "not scheduled")}; time zone: ${quoteRead(read.timezone ?? "not set")}.${read.socialConnection ? ` Account: ${quoteRead(read.socialConnection.externalHandle ?? "unknown handle")}, status ${quoteRead(read.socialConnection.status)}.` : ""}${read.threadPartCount && read.threadPartCount > 1 ? ` Thread of ${read.threadPartCount} posts.` : ""}${read.quotedPostId ? ` Quotes post ${quoteRead(read.quotedPostId)}.` : ""}${read.publishedUrl ? ` Published URL: ${quoteRead(read.publishedUrl)}.` : ""}`;
}

function describeRead(capability: string, value: unknown): string[] {
  if (capability === "list_project_social_accounts") {
    const accounts = z.array(socialAccountObservationSchema);
    // Stored tool calls from before workspace availability contain the array directly.
    const parsed = z
      .union([
        accounts,
        z.object({ accounts }).transform((result) => result.accounts),
      ])
      .safeParse(value);
    if (!parsed.success) return [];
    return [
      `Showing ${parsed.data.length} of ${parsed.data.length} returned social accounts.`,
      ...parsed.data.map(
        (read) =>
          `Observed social account ${quoteRead(read.id)}: platform ${quoteRead(read.provider)}, handle ${quoteRead(read.externalHandle ?? "unknown handle")}, status ${quoteRead(read.status)}. Connected at: ${quoteRead(read.connectedAt ?? "not recorded")}; disconnected at: ${quoteRead(read.disconnectedAt ?? "not recorded")}.${read.textLimit ? ` Text limit: ${read.textLimit} characters.` : ""}`,
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
  if (!isTask && (status === "AWAITING_INPUT" || status === "input_required"))
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
/**
 * What a file's name is chosen by. A voice-over refused because its filename
 * was taken, then made again under a new name, read "Not confirmed: made
 * voice-over." beneath the finished video.
 */
const FILE_NAMING_KEYS = new Set(["filename", "overwrite"]);

/**
 * A talking video refused for its price is made again with a shorter script,
 * as the refusal asks: the same video for the owner.
 */
const REWRITTEN_KEYS: Record<string, Set<string>> = {
  generate_talking_video: new Set(["script", "maxCredits"]),
  // "Social post was modified, reload and retry": the same change again on
  // the post's new revision (CMO chat read "Not confirmed: updated social
  // post (4×)" over four posts it had changed).
  update_social_post: new Set(["revision"]),
};

function normalizeMessageTarget(
  value: unknown,
  allowRoomHash: boolean,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (allowRoomHash && trimmed.startsWith("#")) {
    const room = trimmed.replace(/^#+/, "").trim();
    return room.length > 0 ? `#${room}` : null;
  }
  const handle = trimmed.replace(/^@+/, "").trim();
  return handle.length > 0 ? handle : null;
}

function normalizeMessageText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function sameOptionalText(later: unknown, earlier: unknown): boolean {
  return normalizeMessageText(later) === normalizeMessageText(earlier);
}

/**
 * Structured hand-off fields delivered by `send_message`: two hand-offs with
 * the same opener ("Please handle this.") but different goals/deliverables are
 * distinct assignments and must not mask each other.
 */
function sameHandoffRequest(later: unknown, earlier: unknown): boolean {
  const laterObj = isPlainObject(later);
  const earlierObj = isPlainObject(earlier);
  if (!laterObj && !earlierObj) return true;
  if (!laterObj || !earlierObj) return false;
  return (
    sameOptionalText(later.goal, earlier.goal) &&
    sameOptionalText(later.deliverable, earlier.deliverable) &&
    sameOptionalText(later.deadline, earlier.deadline) &&
    sameOptionalText(later.context, earlier.context)
  );
}

/**
 * Whether `later` retried the same message to the same recipient as `earlier`.
 * A rejected attempt whose extra or invalid field (e.g. a bad `projectId`) was
 * dropped on retry should not print "Not confirmed" beside the confirmed send,
 * while a different message, a different structured `request`, or a different
 * address kind (`#Jordan` room vs `Jordan` person) stays reported.
 */
function sameMessageRetry(
  later: unknown,
  earlier: unknown,
  capability: string,
): boolean {
  if (!isPlainObject(later) || !isPlainObject(earlier)) return false;
  if (capability === "send_message") {
    const laterTo = normalizeMessageTarget(later.to, true);
    const earlierTo = normalizeMessageTarget(earlier.to, true);
    const laterMsg = normalizeMessageText(later.message);
    const earlierMsg = normalizeMessageText(earlier.message);
    return (
      laterTo !== null &&
      laterTo === earlierTo &&
      laterMsg !== null &&
      laterMsg === earlierMsg &&
      sameHandoffRequest(later.request, earlier.request) &&
      sameOptionalText(later.then, earlier.then)
    );
  }
  if (capability === "open_direct_chat") {
    const laterPerson = normalizeMessageTarget(later.person, false);
    const earlierPerson = normalizeMessageTarget(earlier.person, false);
    const laterMsg = normalizeMessageText(later.message);
    const earlierMsg = normalizeMessageText(earlier.message);
    return (
      laterPerson !== null &&
      laterPerson === earlierPerson &&
      laterMsg !== null &&
      laterMsg === earlierMsg
    );
  }
  if (capability === "post_chat") {
    const laterContent = normalizeMessageText(later.content);
    const earlierContent = normalizeMessageText(earlier.content);
    return (
      typeof later.roomId === "string" &&
      later.roomId === earlier.roomId &&
      laterContent !== null &&
      laterContent === earlierContent
    );
  }
  if (capability === "ask_coworker") {
    if (
      !Array.isArray(later.coworkerIds) ||
      !Array.isArray(earlier.coworkerIds)
    )
      return false;
    const laterIds = later.coworkerIds.map(String).sort();
    const earlierIds = earlier.coworkerIds.map(String).sort();
    const laterQuestion = normalizeMessageText(later.question);
    const earlierQuestion = normalizeMessageText(earlier.question);
    return (
      laterIds.length > 0 &&
      laterIds.length === earlierIds.length &&
      laterIds.every((id, index) => id === earlierIds[index]) &&
      laterQuestion !== null &&
      laterQuestion === earlierQuestion
    );
  }
  return false;
}

function inputCovers(
  later: unknown,
  earlier: unknown,
  capability: string,
): boolean {
  if (!isPlainObject(later) || !isPlainObject(earlier)) return false;
  const rewritten = REWRITTEN_KEYS[capability];
  return Object.entries(earlier).every(
    ([key, value]) =>
      FILE_NAMING_KEYS.has(key) ||
      rewritten?.has(key) ||
      JSON.stringify(later[key]) === JSON.stringify(value),
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

/**
 * Whether a Cuso turn saved his Brand Brain, strategy or SEO suggestions.
 * Those writes carry no action receipt, so without this a correction he
 * applied, or a weekly SEO report, would end on "Nothing was changed in this
 * turn."
 */
async function cmoSavedRecord(
  tx: Prisma.TransactionClient,
  turnId: string,
  cmo: boolean,
): Promise<boolean> {
  if (!cmo) return false;
  const saves = await tx.sokoBotToolCall.count({
    where: {
      turnId,
      capability: {
        in: [
          "save_brand_brain",
          "save_strategy",
          "write_strategy",
          "save_seo_suggestions",
        ],
      },
      status: "COMPLETED",
    },
  });
  return saves > 0;
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
  const narrative: ActionNarrative | null =
    parseActionNarrative(narrativeInput) ??
    parseActionNarrativeText(answerText);
  const turnCalls = await tx.sokoBotToolCall.findMany({
    where: {
      turnId,
      capability: {
        in: [...ACTION_RECEIPT_CAPABILITIES, "list_calendar_events"],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const calls = turnCalls.filter(
    (call) =>
      ACTION_CAPABILITIES.has(call.capability) ||
      (call.capability === "investor_warm_paths" && call.disposition !== null),
  );
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
  // target, a retry of the same message to the same recipient, or again with
  // the missing fields filled in — is not something the owner needs to hear
  // about. One whose outcome is unknown always is.
  const madeGood = (call: (typeof calls)[number]) =>
    call.disposition !== "UNKNOWN" &&
    unique.some(
      (applied) =>
        applied.turnId === turnId &&
        applied.capability === call.capability &&
        applied.createdAt > call.createdAt &&
        ((call.targetId !== null && applied.targetId === call.targetId) ||
          inputCovers(applied.input, call.input, call.capability) ||
          sameMessageRetry(applied.input, call.input, call.capability)),
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
  const seoTasks = await seoTaskLabels(tx, turnId, unique);
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
      target: actionTarget(call, tasks, jobAgents, assignedTaskIds, seoTasks),
    })),
  );
  // Cuso reports through a card in the founder's chat. Once he filed one this
  // turn, the receipts repeat the card; only refusals and unknowns, which the
  // card does not carry, still follow as lines.
  // One read of the turn serves every question about it below.
  let turnRow:
    | Promise<{
        source: string | null;
        versionId: string | null;
        parentTurnId: string | null;
      } | null>
    | undefined;
  const turnInfo = () => {
    turnRow ??= tx.sokoBotTurn.findUnique({
      where: { id: turnId },
      select: { source: true, versionId: true, parentTurnId: true },
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
  // Rewriting its own memory is bookkeeping: on a turn nobody asked for (the
  // nightly dream), "Updated memory." alone is not worth a post either.
  const onlyMemory =
    calls.length > 0 &&
    calls.every((call) => call.capability === "update_memory") &&
    !(await isOwnerStarted());
  const silent =
    (!calls.length &&
      (narrative?.kind === "SILENT" ||
        isSokoBotSilentAnswer(answerText) ||
        (actionRequested && nothingToSay && !(await isOwnerStarted())))) ||
    (onlyMemory &&
      !question &&
      (narrative?.kind === "SILENT" ||
        isSokoBotSilentAnswer(message ?? (narrative ? "" : answerText))));
  // A background run of Cuso's (a follow-up once a video is ready) or one
  // of his schedules (the daily update) that filed its card has delivered:
  // its closing words would be a second message saying the same, posted
  // under the card ("The daily update is below.").
  const cardSaysIt =
    reportedByCard &&
    !actionText.length &&
    !question &&
    (Boolean((await turnInfo())?.parentTurnId) ||
      (await turnInfo())?.source === "SCHEDULE");
  // Cuso's owner reads his words and CMO's cards; "Updated social post
  // (28×)." beside them is bookkeeping. Refusals and unknowns still show.
  // When Core cut his words, the receipts are what says what he did.
  const receiptsShown =
    message && !narrative?.replyCheck && (await isCmo())
      ? actionText.filter((line) => !receiptLines.includes(line))
      : actionText;
  const text =
    silent || cardSaysIt
      ? "Nothing to add."
      : calls.length || narrativeText.length
        ? [
            receiptsShown.join("\n"),
            reportedByCard ? "" : attachments.join("\n"),
            narrativeText.join("\n"),
          ]
            .filter(Boolean)
            .join("\n\n") || "Nothing to add."
        : reportedByCard
          ? // The card says what Cuso did; a line beside it would only repeat
            // it, or call a delivered video "nothing changed".
            "Nothing to add."
          : actionRequested &&
              !(await cmoSavedRecord(tx, turnId, await isCmo()))
            ? (await isCmo()) && Boolean((await turnInfo())?.parentTurnId)
              ? // A follow-up of Cuso's that changed nothing (it fetched a
                // finished picture) has nothing to tell: CMO's chat already
                // shows what was made, where he started it.
                "Nothing to add."
              : "Nothing was changed in this turn."
            : answerText;
  // Beside the bot's words, never inside them: an 8,000-character reply has
  // no room left, and the note is Core's, not the bot's.
  const noted =
    narrative?.replyCheck && text !== "Nothing to add."
      ? `${text}\n\n${REPLY_CHECK_NOTES[narrative.replyCheck]}`
      : text;
  // A draft Core refused for want of an account: Core asks, with the stored
  // options in order, so what the owner reads is what the next turn checks.
  // Settlement rebuilds the answer; the question goes in once.
  const refusedPost = turnCalls.some(
    (call) =>
      call.capability === "create_social_post" && call.status === "FAILED",
  );
  // A rebuild from the stored answer drops Core's earlier question first: the
  // options may have changed since, and the reply shows the current ones.
  // Only Core's own block goes: the heading and its numbered options, last
  // in the text, on a turn whose draft was refused. The bot's words stay.
  const base = refusedPost ? withoutAccountQuestionBlock(noted) : noted;
  const asked = refusedPost
    ? await showAccountQuestion(tx, turnId, base !== "Nothing to add.")
    : null;
  const checked = asked ? `${base}\n\n${asked}` : base;
  return {
    appliedReceiptIds,
    narrative,
    observations,
    unfulfilledActions,
    // Cuso's owner reads this in CMO.xyz, where nothing opens Sokosumi.
    answerText: (await isCmo())
      ? withoutSokosumiLinks(checked, getWebAppBaseUrl())
      : linkCalendarContacts(checked, turnCalls),
  };
}

import { createHash } from "node:crypto";
import type {
  Prisma,
  SokoBotFulfillmentState,
  SokoBotTurnRoute,
} from "@sokosumi/database";
import { z } from "zod";
import {
  buildSokoBotAudienceTaskVisibilityWhere,
  readSokoBotPacketAudience,
  type SokoBotPacketAudience,
} from "@/helpers/task-visibility";

import {
  ACTION_CAPABILITIES,
  actionInputHash,
  verifyTaskArchiveReceipt,
} from "@/lib/soko-bot/action-receipts";

const VERIFIER_VERSION = "transactional-receipts-v1";

/** User-facing state comes from assessed evidence, never generated success prose. */
export function sokoBotOutcomeSummary(
  outcome:
    | {
        state: SokoBotFulfillmentState;
        blockerKind: string | null;
        remainingSteps: Prisma.JsonValue;
      }
    | null
    | undefined,
): string | null {
  if (!outcome || outcome.blockerKind === "NO_ACCEPTANCE_CRITERIA") return null;
  const states: Record<SokoBotFulfillmentState, string> = {
    UNKNOWN: "The requested outcome has not been verified.",
    IN_PROGRESS: "The requested outcome is still in progress.",
    FULFILLED: "The requested outcome has been verified.",
    PARTIAL: "The requested outcome is partially complete.",
    BLOCKED: "The requested outcome is blocked.",
    FAILED: "The requested outcome failed.",
    CANCELLED: "The requested outcome was cancelled.",
  };
  const blockers: Record<string, string> = {
    OUTCOME_SCOPE_REQUIRES_REVIEW:
      "The result still needs a review against the requested scope.",
    ARTIFACT_READABILITY_UNVERIFIED:
      "The attached result still needs an authorized readability check.",
    RESULT_EVIDENCE_UNAVAILABLE: "Result evidence is not yet available.",
    UNCERTAIN_ACTION:
      "An action outcome is uncertain; reconciliation is required before retrying.",
    EVIDENCE_CHANGED: "New evidence requires a fresh assessment.",
    UNVERIFIED_OUTCOME: "The result still needs verification.",
    INVALID_ACCEPTANCE_CRITERIA:
      "Acceptance criteria need clarification before verification.",
  };
  const blocker =
    outcome.blockerKind && Object.hasOwn(blockers, outcome.blockerKind)
      ? blockers[outcome.blockerKind]
      : null;
  const remaining = Array.isArray(outcome.remainingSteps)
    ? outcome.remainingSteps.length
    : 0;
  return [
    states[outcome.state],
    blocker,
    remaining > 0
      ? `${remaining} acceptance ${remaining === 1 ? "criterion remains" : "criteria remain"} unverified.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}
const criteriaSchema = z
  .array(
    z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("ACTION"),
          id: z.string().min(1).max(120),
          capability: z.string().min(1).max(80),
          targetId: z.string().min(1).max(120).nullable(),
          inputHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .strict(),
      // Free-text outcomes need independent verification. A worker's COMPLETED
      // status or an existing attachment does not verify requested content.
      z
        .object({
          kind: z.literal("OUTCOME"),
          id: z.string().min(1).max(120),
          description: z.string().min(1).max(1000),
        })
        .strict(),
    ]),
  )
  .max(32);

interface ReceiptEvidence {
  id: string;
  turnId?: string;
  capability: string;
  targetId: string | null;
  inputHash?: string;
  status: string;
  disposition: string | null;
  verification: string;
  committedAt: Date | null;
}

interface TaskOutcomeEvidence extends Prisma.InputJsonObject {
  taskId: string;
  status: string;
  revision: string;
  eventId: string | null;
  author: {
    userId: string | null;
    coworkerId: string | null;
    sokoBotId: string | null;
  } | null;
  readableInlineResult: boolean;
  artifactIds: string[];
}

/** Call only after a human approves the exact parsed proposal. The input hash
 * prevents another operation on the same entity from satisfying this decision.
 */
export function criteriaForConfirmedSokoBotAction(
  capability: string,
  proposal: unknown,
) {
  const fields = z
    .object({
      taskId: z.string().optional(),
      jobId: z.string().optional(),
      scheduleId: z.string().optional(),
    })
    .passthrough()
    .parse(proposal);
  const criteria: z.infer<typeof criteriaSchema> = [
    {
      kind: "ACTION",
      id: "confirmed-action",
      capability,
      targetId: fields.taskId ?? fields.jobId ?? fields.scheduleId ?? null,
      inputHash: actionInputHash(proposal),
    },
  ];
  if (capability === "create_task" || capability === "hire_agent") {
    criteria.push({
      kind: "OUTCOME",
      id: "delegated-outcome",
      description:
        "Verify the requested work independently of task or job creation and completion status.",
    });
  }
  return criteriaSchema.parse(criteria);
}

/** A receipt only a committed local effect can produce; reads never qualify. */
function provenActionReceipt(
  receipt: ReceiptEvidence,
  invalidatedAt?: Date,
): boolean {
  return (
    receipt.status === "COMPLETED" &&
    (receipt.disposition === "APPLIED" ||
      receipt.disposition === "ALREADY_SATISFIED") &&
    receipt.verification !== "NONE" &&
    receipt.committedAt !== null &&
    receipt.targetId !== null &&
    (!invalidatedAt || receipt.committedAt > invalidatedAt)
  );
}

/**
 * Delegation hands the work to somebody else, so its receipt cannot prove the
 * change a `MANAGE_WORK` turn was supposed to make itself; that work still
 * needs independent verification.
 */
const DELEGATED_CAPABILITIES = new Set([
  "create_task",
  "hire_agent",
  "provide_job_input",
]);

/**
 * The action a `MANAGE_WORK` turn committed for the request it ran.
 *
 * Every action capability the turn attempted must end on a committed receipt:
 * a preparatory write followed by the requested action failing does not prove
 * the request happened, so nothing is returned. Retried attempts are fine
 * because only each capability's last call counts. Receipts at or before the
 * latest invalidation are ignored, so a replacement action has to commit after
 * new evidence changed the outcome.
 */
function committedDirectAction(
  turnId: string,
  receipts: readonly ReceiptEvidence[],
  invalidatedAt: Date | undefined,
): ReceiptEvidence | null {
  const attempts = receipts.filter(
    (receipt) =>
      receipt.turnId === turnId &&
      ACTION_CAPABILITIES.has(receipt.capability) &&
      !DELEGATED_CAPABILITIES.has(receipt.capability),
  );
  if (attempts.length === 0) return null;
  const committed = (receipt: ReceiptEvidence) =>
    provenActionReceipt(receipt, invalidatedAt);
  const lastByCapability = new Map<string, ReceiptEvidence>();
  for (const attempt of attempts)
    lastByCapability.set(attempt.capability, attempt);
  if (![...lastByCapability.values()].every(committed)) return null;
  // The latest committed change is the closest thing to the requested one.
  return [...attempts].reverse().find(committed) ?? null;
}

/**
 * Rewrite the classifier's `requested-outcome` criterion into the action a
 * `MANAGE_WORK` turn committed itself.
 *
 * The classifier builds the intent before the model picks a capability, so
 * that criterion is an OUTCOME: on a delegation it stays open until the work
 * is independently verified. `MANAGE_WORK` is different — the assistant makes
 * the change, and its committed receipt is the proof. Without this rewrite the
 * criterion can never be satisfied by a social post, chat message, file, or
 * reminder, and settlement reports a completed action as blocked.
 */
function criteriaWithDirectActionProof(
  route: SokoBotTurnRoute | null,
  turnId: string,
  criteria: Prisma.JsonValue,
  receipts: readonly ReceiptEvidence[],
  invalidatedAt: Date | undefined,
) {
  if (route !== "MANAGE_WORK") return criteria;
  const parsed = criteriaSchema.safeParse(criteria);
  const proof = committedDirectAction(turnId, receipts, invalidatedAt);
  if (!parsed.success || !proof?.targetId) return criteria;
  return criteriaSchema.parse(
    parsed.data.map((criterion) =>
      criterion.kind === "OUTCOME" && criterion.id === "requested-outcome"
        ? {
            kind: "ACTION",
            id: criterion.id,
            capability: proof.capability,
            targetId: proof.targetId,
            ...(proof.inputHash ? { inputHash: proof.inputHash } : {}),
          }
        : criterion,
    ),
  );
}

export function evaluateSokoBotOutcome(input: {
  criteria: unknown;
  receipts: readonly ReceiptEvidence[];
  intentState: string;
  executionStatus: string;
  invalidatedAt?: Date;
  taskEvidence?: readonly TaskOutcomeEvidence[];
}) {
  const parsed = criteriaSchema.safeParse(input.criteria);
  const criteria = parsed.success ? parsed.data : [];
  const results = criteria.map((criterion) => {
    const receipt =
      criterion.kind === "ACTION"
        ? input.receipts.find(
            (item) =>
              item.capability === criterion.capability &&
              (criterion.targetId === null
                ? item.targetId !== null && !!criterion.inputHash
                : item.targetId === criterion.targetId) &&
              (!criterion.inputHash ||
                item.inputHash === criterion.inputHash) &&
              provenActionReceipt(item, input.invalidatedAt),
          )
        : undefined;
    return {
      id: criterion.id,
      satisfied: !!receipt,
      evidenceId: receipt?.id ?? null,
      ...(criterion.kind === "OUTCOME"
        ? {
            inspection: input.taskEvidence ?? [],
            // Readable bytes establish availability, not requested research coverage.
            scopeVerified: false,
          }
        : {}),
    };
  });
  const satisfied = results.filter((result) => result.satisfied).length;
  let state: SokoBotFulfillmentState = "IN_PROGRESS";
  let blockerKind: string | null = null;
  if (["CANCELLED", "SUPERSEDED"].includes(input.intentState))
    state = "CANCELLED";
  else if (!parsed.success || criteria.length === 0) {
    state = "UNKNOWN";
    blockerKind = parsed.success
      ? "NO_ACCEPTANCE_CRITERIA"
      : "INVALID_ACCEPTANCE_CRITERIA";
  } else if (satisfied === criteria.length) state = "FULFILLED";
  else if (input.invalidatedAt) {
    state = "UNKNOWN";
    blockerKind = "EVIDENCE_CHANGED";
  } else if (satisfied > 0) state = "PARTIAL";
  else if (
    input.receipts.some((receipt) => receipt.disposition === "UNKNOWN")
  ) {
    state = "BLOCKED";
    blockerKind = "UNCERTAIN_ACTION";
  } else if (input.executionStatus === "FAILED") state = "FAILED";
  else if (input.executionStatus === "CANCELLED") state = "CANCELLED";
  else if (input.executionStatus === "COMPLETED") {
    state = "BLOCKED";
    blockerKind = "UNVERIFIED_OUTCOME";
  }
  if (
    (blockerKind === "UNVERIFIED_OUTCOME" ||
      (!blockerKind && state === "PARTIAL")) &&
    criteria.some((criterion) => criterion.kind === "OUTCOME")
  ) {
    const evidence = input.taskEvidence ?? [];
    blockerKind = evidence.some((item) => item.readableInlineResult)
      ? "OUTCOME_SCOPE_REQUIRES_REVIEW"
      : evidence.some((item) => item.artifactIds.length > 0)
        ? "ARTIFACT_READABILITY_UNVERIFIED"
        : "RESULT_EVIDENCE_UNAVAILABLE";
  }
  return {
    state,
    blockerKind,
    criteriaResults: results,
    evidenceIds: results.flatMap((result) =>
      result.evidenceId ? [result.evidenceId] : [],
    ),
    remainingSteps: results
      .filter((result) => !result.satisfied)
      .map((result) => result.id),
  };
}

/** Called within settlement's transaction; execution and delivery stay independent. */
export async function assessSokoBotIntentOutcome(
  tx: Prisma.TransactionClient,
  turnId: string,
) {
  const turn = await tx.sokoBotTurn.findUnique({
    where: { id: turnId },
    include: { intent: true, contextSnapshot: { select: { packet: true } } },
  });
  if (!turn?.intent || turn.intentRevision !== turn.intent.revision)
    return null;
  const intent = turn.intent;
  const targetIds = z.array(z.string()).safeParse(intent.targetIds);
  const receipts = await tx.sokoBotToolCall.findMany({
    where: {
      actorBotId: turn.sokoBotId,
      turn: {
        intentId: intent.id,
        intentRevision: intent.revision,
        workspaceId: turn.workspaceId,
        sokoBotId: turn.sokoBotId,
      },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      turnId: true,
      capability: true,
      targetId: true,
      inputHash: true,
      status: true,
      disposition: true,
      verification: true,
      committedAt: true,
      effectEventId: true,
    },
  });
  const invalidation = await tx.sokoBotIntentOutcome.findFirst({
    where: {
      intentId: intent.id,
      intentRevision: intent.revision,
      blockerKind: "EVIDENCE_CHANGED",
      verifierVersion: "event-invalidation-v1",
    },
    orderBy: { assessedAt: "desc" },
  });
  const currentReceipts = [];
  for (const receipt of receipts) {
    if (
      receipt.capability !== "archive_task" ||
      (await verifyTaskArchiveReceipt(tx, receipt.id))
    )
      currentReceipts.push(receipt);
  }
  const assessmentCriteria = criteriaWithDirectActionProof(
    turn.route,
    turn.id,
    intent.acceptanceCriteria,
    currentReceipts,
    invalidation?.assessedAt,
  );
  const criteria = criteriaSchema.safeParse(assessmentCriteria);
  const taskEvidence: TaskOutcomeEvidence[] = [];
  if (
    criteria.success &&
    criteria.data.some((criterion) => criterion.kind === "OUTCOME") &&
    targetIds.success &&
    targetIds.data.length > 0
  ) {
    // Reuse the runtime's audience boundary. Never fetch arbitrary result URLs;
    // external artifacts remain unverified until an authorized reader checks them.
    const tasks = await tx.task.findMany({
      where: {
        id: { in: targetIds.data.slice(0, 32) },
        workspaceId: turn.workspaceId,
        archivedAt: null,
        ...buildSokoBotAudienceTaskVisibilityWhere(
          turn.userId,
          readSokoBotPacketAudience(turn.contextSnapshot?.packet),
        ),
      },
      take: 32,
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        events: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            id: true,
            comment: true,
            status: true,
            userId: true,
            coworkerId: true,
            sokoBotId: true,
          },
        },
        files: {
          where: { status: "READY" },
          take: 32,
          orderBy: { id: "asc" },
          select: { id: true },
        },
      },
    });
    for (const task of tasks) {
      const event = task.events[0];
      const text = event?.comment?.trim() ?? "";
      taskEvidence.push({
        taskId: task.id,
        status: task.status,
        revision: task.updatedAt.toISOString(),
        eventId: event?.id ?? null,
        author: event
          ? {
              userId: event.userId,
              coworkerId: event.coworkerId,
              sokoBotId: event.sokoBotId,
            }
          : null,
        readableInlineResult:
          task.status === "COMPLETED" &&
          event?.status === "COMPLETED" &&
          text.length > 0 &&
          text.length <= 24_000 &&
          !/^https?:\/\/\S+$/.test(text),
        artifactIds: task.files.map((file) => file.id),
      });
    }
  }
  const assessment = evaluateSokoBotOutcome({
    criteria: assessmentCriteria,
    receipts: currentReceipts,
    intentState: intent.state,
    executionStatus: turn.status,
    invalidatedAt: invalidation?.assessedAt,
    taskEvidence,
  });
  const evidenceRevision = createHash("sha256")
    .update(
      JSON.stringify({
        assessment,
        receiptIds: receipts.map((receipt) => receipt.id),
        invalidationId: invalidation?.id ?? null,
      }),
    )
    .digest("hex");
  const outcome = await tx.sokoBotIntentOutcome.upsert({
    where: {
      intentId_intentRevision_evidenceRevision: {
        intentId: intent.id,
        intentRevision: intent.revision,
        evidenceRevision,
      },
    },
    create: {
      intentId: intent.id,
      intentRevision: intent.revision,
      evidenceRevision,
      ...assessment,
      verifierVersion: VERIFIER_VERSION,
    },
    update: {},
  });
  await tx.sokoBotTurn.updateMany({
    where: { intentId: intent.id, intentRevision: intent.revision },
    data: { fulfillmentState: assessment.state },
  });
  if (assessment.state === "FULFILLED") {
    for (const receipt of receipts) {
      if (
        !assessment.evidenceIds.includes(receipt.id) ||
        !receipt.targetId ||
        !receipt.effectEventId ||
        !receipt.committedAt
      )
        continue;
      // A later failure/input request must not be hidden by an older successful
      // action. Only the task's current event can resolve earlier reminders.
      const current = await tx.task.findFirst({
        where: {
          id: receipt.targetId,
          workspaceId: turn.workspaceId,
          status: { in: ["READY", "RUNNING", "COMPLETED", "CANCELED"] },
          ...buildSokoBotAudienceTaskVisibilityWhere(
            turn.userId,
            readSokoBotPacketAudience(turn.contextSnapshot?.packet),
          ),
        },
        select: {
          events: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { id: true },
          },
        },
      });
      if (current?.events[0]?.id !== receipt.effectEventId) continue;
      await tx.sokoBotNudge.updateMany({
        where: {
          sokoBotId: turn.sokoBotId,
          state: { in: ["ACTIVE", "ACKNOWLEDGED", "SNOOZED"] },
          lastAt: { lte: receipt.committedAt },
          OR: ["stale", "unanswered", "failed"].map((reason) => ({
            key: { startsWith: `${reason}:${receipt.targetId}:` },
          })),
        },
        data: {
          state: "RESOLVED",
          resolvedAt: new Date(),
          pendingTurnId: null,
          nextCheckAt: null,
          snoozedUntil: null,
          revision: { increment: 1 },
        },
      });
    }
  }
  return outcome;
}

/** Any later source change conservatively invalidates the old assessment.
 * Reverification requires newer receipts, never a worker status alone.
 */
export async function invalidateSokoBotIntentOutcomes(
  tx: Prisma.TransactionClient,
  input: {
    sokoBotId: string;
    workspaceId: string;
    targetId: string;
    evidenceId: string;
  },
) {
  let cursor: string | undefined;
  while (true) {
    const intents = await tx.sokoBotIntent.findMany({
      select: { id: true, revision: true },
      orderBy: { id: "asc" },
      take: 100,
      where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        sokoBotId: input.sokoBotId,
        workspaceId: input.workspaceId,
        targetIds: { array_contains: [input.targetId] },
        state: { notIn: ["CANCELLED", "SUPERSEDED"] },
      },
    });
    for (const intent of intents) {
      const evidenceRevision = createHash("sha256")
        .update(`invalidate:${input.targetId}:${input.evidenceId}`)
        .digest("hex");
      const existing = await tx.sokoBotIntentOutcome.findUnique({
        where: {
          intentId_intentRevision_evidenceRevision: {
            intentId: intent.id,
            intentRevision: intent.revision,
            evidenceRevision,
          },
        },
      });
      if (existing) continue;
      await tx.sokoBotIntentOutcome.upsert({
        where: {
          intentId_intentRevision_evidenceRevision: {
            intentId: intent.id,
            intentRevision: intent.revision,
            evidenceRevision,
          },
        },
        create: {
          intentId: intent.id,
          intentRevision: intent.revision,
          evidenceRevision,
          state: "UNKNOWN",
          criteriaResults: [],
          evidenceIds: [input.evidenceId],
          remainingSteps: [],
          blockerKind: "EVIDENCE_CHANGED",
          verifierVersion: "event-invalidation-v1",
        },
        update: {},
      });
      await tx.sokoBotTurn.updateMany({
        where: { intentId: intent.id, intentRevision: intent.revision },
        data: { fulfillmentState: "UNKNOWN" },
      });
    }
    if (intents.length < 100) break;
    cursor = intents.at(-1)?.id;
  }
}

/** Read one current intent's assessment, never a task-wide inferred outcome. */
interface SokoBotTaskOutcome {
  state: SokoBotFulfillmentState;
  acceptanceCriteria: Prisma.JsonValue;
  criteriaResults: Prisma.JsonValue;
  evidenceIds: Prisma.JsonValue;
  remainingSteps: Prisma.JsonValue;
  blockerKind: string | null;
  evidenceRevision: string | null;
  assessedAt: string | null;
}

export async function readSokoBotTaskOutcome(
  tx: Prisma.TransactionClient,
  input: {
    turnId: string;
    sokoBotId: string;
    workspaceId: string;
    userId: string;
    intentId?: string | null;
    intentRevision?: number | null;
    audience?: SokoBotPacketAudience;
    taskId: string;
  },
): Promise<SokoBotTaskOutcome> {
  const unknown: SokoBotTaskOutcome = {
    state: "UNKNOWN",
    acceptanceCriteria: [],
    criteriaResults: [],
    evidenceIds: [],
    remainingSteps: [],
    blockerKind: "NO_CURRENT_AUTHORIZED_ASSESSMENT",
    evidenceRevision: null,
    assessedAt: null,
  };
  if (
    input.audience !== "OWNER" ||
    !input.intentId ||
    input.intentRevision == null
  )
    return unknown;
  const turn = await tx.sokoBotTurn.findFirst({
    where: {
      id: input.turnId,
      sokoBotId: input.sokoBotId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      intentId: input.intentId,
      intentRevision: input.intentRevision,
      chainDepth: 0,
      OR: [{ requestedByUserId: null }, { requestedByUserId: input.userId }],
    },
    select: {
      contextSnapshot: { select: { packet: true } },
      chatMention: { select: { message: { select: { roomId: true } } } },
      intent: true,
    },
  });
  const intent = turn?.intent;
  if (
    !intent ||
    readSokoBotPacketAudience(turn.contextSnapshot?.packet) !== "OWNER" ||
    intent.sokoBotId !== input.sokoBotId ||
    intent.workspaceId !== input.workspaceId ||
    intent.requesterId !== input.userId ||
    intent.revision !== input.intentRevision ||
    intent.roomId !== (turn.chatMention?.message.roomId ?? null)
  )
    return unknown;
  const targets = z.array(z.string()).safeParse(intent.targetIds);
  if (!targets.success || !targets.data.includes(input.taskId)) return unknown;
  const task = await tx.task.findFirst({
    where: {
      id: input.taskId,
      workspaceId: input.workspaceId,
      archivedAt: null,
      ...buildSokoBotAudienceTaskVisibilityWhere(input.userId, "OWNER"),
    },
    select: {
      updatedAt: true,
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, createdAt: true, updatedAt: true },
      },
    },
  });
  if (!task) return unknown;
  const outcome = await tx.sokoBotIntentOutcome.findFirst({
    where: { intentId: intent.id, intentRevision: intent.revision },
    orderBy: [{ assessedAt: "desc" }, { id: "desc" }],
  });
  if (!outcome) return unknown;
  if (["CANCELLED", "SUPERSEDED"].includes(intent.state))
    return {
      ...unknown,
      state: "CANCELLED",
      blockerKind: "INTENT_CANCELLED",
    };
  const latestEvent = task.events[0];
  let proofChanged = false;
  if (outcome.state === "FULFILLED") {
    const evidenceIds = z
      .array(z.string())
      .max(32)
      .safeParse(outcome.evidenceIds);
    const proofs = evidenceIds.success
      ? await tx.sokoBotToolCall.findMany({
          where: {
            id: { in: evidenceIds.data },
            actorBotId: input.sokoBotId,
            status: "COMPLETED",
            disposition: { in: ["APPLIED", "ALREADY_SATISFIED"] },
            verification: { not: "NONE" },
            committedAt: { not: null },
            turn: {
              sokoBotId: input.sokoBotId,
              workspaceId: input.workspaceId,
              intentId: intent.id,
              intentRevision: intent.revision,
            },
          },
          select: { targetId: true, effectEventId: true, committedAt: true },
        })
      : [];
    const latestProofAt = Math.max(
      0,
      ...proofs.map((proof) => proof.committedAt?.getTime() ?? 0),
    );
    proofChanged =
      proofs.length === 0 ||
      task.updatedAt.getTime() > latestProofAt ||
      proofs.some(
        (proof) =>
          proof.targetId === input.taskId &&
          proof.effectEventId &&
          proof.effectEventId !== latestEvent?.id,
      ) ||
      (!!latestEvent &&
        Math.max(
          latestEvent.createdAt.getTime(),
          latestEvent.updatedAt.getTime(),
        ) > latestProofAt);
  }
  if (
    proofChanged ||
    task.updatedAt > outcome.assessedAt ||
    (latestEvent &&
      (latestEvent.createdAt > outcome.assessedAt ||
        latestEvent.updatedAt > outcome.assessedAt))
  ) {
    const criteria = criteriaSchema.safeParse(intent.acceptanceCriteria);
    return {
      ...unknown,
      blockerKind: "EVIDENCE_CHANGED",
      acceptanceCriteria: intent.acceptanceCriteria,
      remainingSteps: criteria.success
        ? criteria.data.map((criterion) => criterion.id)
        : [],
    };
  }
  return {
    state: outcome.state,
    acceptanceCriteria: intent.acceptanceCriteria,
    criteriaResults: outcome.criteriaResults,
    evidenceIds: outcome.evidenceIds,
    remainingSteps: outcome.remainingSteps,
    blockerKind: outcome.blockerKind,
    evidenceRevision: outcome.evidenceRevision,
    assessedAt: outcome.assessedAt.toISOString(),
  };
}

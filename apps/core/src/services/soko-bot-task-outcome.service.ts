import type { Prisma, SokoBotFulfillmentState } from "@sokosumi/database";
import { z } from "zod";
import { sokoBotTurnAudience } from "@/helpers/soko-bot-owner";
import {
  buildSokoBotAudienceTaskVisibilityWhere,
  type SokoBotPacketAudience,
} from "@/helpers/task-visibility";
import { criteriaSchema } from "@/services/soko-bot-outcome.service";

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
      sokoBot: { select: { userId: true } },
      chatMention: { select: { message: { select: { roomId: true } } } },
      intent: true,
    },
  });
  const intent = turn?.intent;
  if (
    !intent ||
    sokoBotTurnAudience(turn) !== "OWNER" ||
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

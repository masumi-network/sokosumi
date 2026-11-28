import type { Prisma, SokoBotTurn } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { sokoBotProvideJobInputSchema as provideJobInputSchema } from "@sokosumi/soko-bot";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { serviceUnavailable } from "@/helpers/error";
import { networkStamp } from "@/helpers/preprod-control";
import { findResolvableSokoBotDecision } from "@/helpers/soko-bot-management";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { sokoBotActingUserId } from "@/lib/soko-bot/acting-user";
import {
  actionInputHash,
  actionOperationKey,
  verifyTaskArchiveReceipt,
} from "@/lib/soko-bot/action-receipts";
import {
  DetachedNetworkRefusal,
  detachedNetworkScope,
  requireDetachedTurnProvenance,
  turnProvenance,
} from "@/lib/soko-bot/detached-network";
import {
  isSokoBotDecisionTargetAllowed,
  type SokoBotActionContext,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf, actionPrincipalId } from "./acting-scope";
import { type RuntimeOperations } from "./operations";

export async function expireStaleDecision(decisionId: string) {
  await prisma.sokoBotPendingDecision.updateMany({
    where: { id: decisionId, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "EXPIRED", resolvedAt: new Date() },
  });
}

export type ConfirmationTurn = Pick<
  SokoBotTurn,
  "id" | "network" | "preprodGeneration"
>;

export async function prepareDecision(
  runtime: RuntimeOperations,
  /** Null only when the bot accepts its own card in a turn for nobody. */
  resolverUserId: string | null,
  decisionId: string,
  accepted: boolean,
  ownerConfirmed = true,
  confirmation?: ConfirmationTurn,
) {
  const decision = await findResolvableSokoBotDecision(
    resolverUserId,
    decisionId,
    accepted,
    ownerConfirmed,
  );
  if (!decision)
    throw new SokoBotRuntimeValidationError("Pending decision not found");
  // Whoever answers, the decision acts for the member who asked.
  const actingUserId = sokoBotActingUserId(decision);
  if (
    decision.status === "PENDING" &&
    decision.expiresAt.getTime() <= Date.now()
  ) {
    await prisma.sokoBotPendingDecision.update({
      where: { id: decision.id },
      data: { status: "EXPIRED", resolvedAt: new Date() },
    });
    throw new SokoBotRuntimeConflictError("Pending decision expired");
  }
  if (decision.intentId) {
    const intent = await prisma.sokoBotIntent.findFirst({
      where: {
        id: decision.intentId,
        ...(decision.requestedByUserId
          ? { requesterId: decision.requestedByUserId }
          : {}),
        state: { in: ["AWAITING_CONFIRMATION", "IN_PROGRESS"] },
        expiresAt: { gt: new Date() },
      },
    });
    if (!intent)
      throw new SokoBotRuntimeConflictError(
        "Pending intent is no longer valid",
      );
  }
  if (!accepted) {
    if (decision.intentId)
      await prisma.sokoBotIntent.update({
        where: { id: decision.intentId },
        data: { state: "CANCELLED", revision: { increment: 1 } },
      });
    const rejected = await prisma.sokoBotPendingDecision.updateMany({
      where: { id: decision.id, status: "PENDING" },
      data: {
        status: "REJECTED",
        resolvedAt: new Date(),
        resolvedByUserId: resolverUserId,
      },
    });
    if (rejected.count === 0) {
      throw new SokoBotRuntimeConflictError(
        "Pending decision was already resolved",
      );
    }
    return {
      done: true as const,
      result: await prisma.sokoBotPendingDecision.findUniqueOrThrow({
        where: { id: decision.id },
      }),
    };
  }

  const handleRefusal = async (error: unknown): Promise<never> => {
    if (error instanceof DetachedNetworkRefusal && error.final) {
      await expireStaleDecision(decision.id);
    }
    throw error;
  };
  const scope = await detachedNetworkScope(decision.turn).catch(handleRefusal);
  const provenance = turnProvenance(decision.turn);
  const stale = () =>
    new DetachedNetworkRefusal(CORE_API_ERROR_KINDS.SOKO_BOT_NETWORK_STALE);
  if (
    confirmation &&
    (confirmation.network !== provenance.network ||
      (provenance.network === "preprod" &&
        confirmation.preprodGeneration !==
          provenance.expectedPreprodGeneration))
  ) {
    throw stale();
  }
  const decisionToolCallId = `decision:${decision.id}`;
  const externalDecision =
    decision.toolName === "hire_agent" ||
    decision.toolName === "provide_job_input";
  const actionContext: SokoBotActionContext = {
    provenance,
    confirmationTurnId: confirmation?.id,
    turn: {
      id: decision.turnId,
      sokoBotId: decision.sokoBotId,
      actingUserId,
      requestedByUserId: decision.requestedByUserId,
      workspaceId: decision.workspaceId,
      eveSessionId: decision.turn.eveSessionId,
      versionId: decision.turn.versionId,
      source: decision.turn.source,
      chainDepth: decision.turn.chainDepth,
    },
    classificationConfidence: 1,
  };
  const receiptKey = {
    turnId: decision.turnId,
    toolCallId: decisionToolCallId,
  };
  const receiptIdentity = {
    ...receiptKey,
    capability: decision.toolName,
    inputHash: actionInputHash(decision.proposal),
    actorBotId: decision.sokoBotId,
    operationKey: actionOperationKey({
      workspaceId: decision.workspaceId,
      principalId: actionPrincipalId({
        actingUserId,
        sokoBotId: decision.sokoBotId,
      }),
      intentRevision: decisionToolCallId,
      capability: decision.toolName,
      inputHash: actionInputHash(decision.proposal),
    }),
  };
  const acknowledgeExternalReceipt = async (
    targetId: string,
    tx: Prisma.TransactionClient = prisma,
  ) => {
    const data = {
      status: "COMPLETED" as const,
      disposition: "APPLIED" as const,
      verification: "PROVIDER_ACK" as const,
      targetId,
      committedAt: new Date(),
      result: {
        executed: true,
        status: "ACCEPTED",
        resultingEntityId: targetId,
      },
    };
    await tx.sokoBotToolCall.upsert({
      where: { turnId_toolCallId: receiptKey },
      create: { ...receiptIdentity, ...data },
      update: data,
    });
  };

  let resumeProcessing = false;
  if (decision.status === "PROCESSING") {
    const existingDelegation = await prisma.sokoBotDelegation.findUnique({
      where: {
        turnId_toolCallId: {
          turnId: decision.turnId,
          toolCallId: decisionToolCallId,
        },
      },
      select: {
        action: true,
        outcome: true,
        taskId: true,
        jobId: true,
        network: true,
        preprodGeneration: true,
      },
    });
    if (existingDelegation && scope.network === "preprod") {
      try {
        requireDetachedTurnProvenance(provenance, existingDelegation);
      } catch (error) {
        await handleRefusal(error);
      }
    }
    if (
      scope.network === "mainnet" &&
      existingDelegation?.jobId &&
      existingDelegation.network === "preprod"
    ) {
      await handleRefusal(stale());
    }
    let recoveredEntityId = existingDelegation?.taskId ?? null;
    if (decision.toolName === "hire_agent") {
      recoveredEntityId = existingDelegation?.jobId ?? null;
      if (recoveredEntityId && scope.network === "preprod") {
        const job = await scope.networkDb.job.findFirst({
          where: {
            id: recoveredEntityId,
            workspaceId: decision.workspaceId,
            ownerId: actingMemberOf(actionContext),
          },
          select: { id: true },
        });
        if (!job) await handleRefusal(stale());
      }
    } else if (decision.toolName === "provide_job_input") {
      const proposal = provideJobInputSchema.parse(decision.proposal);
      const existingInput =
        scope.network === "preprod"
          ? await scope.networkDb.jobInput.findUnique({
              where: {
                eventId: proposal.eventId,
                event: {
                  jobId: proposal.jobId,
                  job: {
                    workspaceId: decision.workspaceId,
                    ownerId: actingMemberOf(actionContext),
                  },
                },
              },
              select: { id: true },
            })
          : await prisma.jobInput.findUnique({
              where: { eventId: proposal.eventId },
              select: { id: true },
            });
      recoveredEntityId = existingInput?.id ?? null;
    }
    if (recoveredEntityId) {
      if (decision.toolName === "archive_task") {
        const receipt = await prisma.sokoBotToolCall.findUnique({
          where: { turnId_toolCallId: receiptKey },
          select: { id: true },
        });
        if (!receipt || !(await verifyTaskArchiveReceipt(prisma, receipt.id))) {
          throw new SokoBotRuntimeConflictError(
            "Archived task history could not be verified",
          );
        }
      }
      if (scope.network === "preprod") {
        const targetId = recoveredEntityId;
        const result = await serializableTransaction(async (tx) => {
          await networkStamp(provenance, tx);
          if (existingDelegation) {
            const updated = await tx.sokoBotDelegation.updateMany({
              where: {
                ...receiptKey,
                network: provenance.network,
                preprodGeneration: provenance.expectedPreprodGeneration,
                jobId: existingDelegation.jobId,
                outcome: existingDelegation.outcome,
              },
              data: { outcome: "accepted", error: null },
            });
            if (updated.count !== 1) {
              throw new SokoBotRuntimeConflictError(
                "Soko Bot reservation changed during recovery",
              );
            }
          }
          if (externalDecision) await acknowledgeExternalReceipt(targetId, tx);
          return tx.sokoBotPendingDecision.update({
            where: { id: decision.id, status: "PROCESSING" },
            data: {
              status: "ACCEPTED",
              resolvedAt: new Date(),
              resolvedByUserId: decision.firstResolverUserId,
              resultingEntityId: targetId,
            },
          });
        }, "Soko Bot approval recovery changed concurrently").catch(
          handleRefusal,
        );
        return { done: true as const, result };
      }
      if (externalDecision) await acknowledgeExternalReceipt(recoveredEntityId);
      const [, recoveredDecision] = await prisma.$transaction([
        decision.toolName === "hire_agent"
          ? prisma.$executeRaw`
              UPDATE ${sharedTable("soko_bot_delegation")}
              SET "outcome" = 'accepted',
                  "jobId" = ${recoveredEntityId},
                  "network" = COALESCE("network", ${provenance.network}),
                  "error" = NULL,
                  "updatedAt" = ${new Date()}
              WHERE "turnId" = ${decision.turnId}::uuid
                AND "toolCallId" = ${decisionToolCallId}
            `
          : prisma.sokoBotDelegation.updateMany({
              where: {
                turnId: decision.turnId,
                toolCallId: decisionToolCallId,
              },
              data: { outcome: "accepted", error: null },
            }),
        prisma.sokoBotPendingDecision.update({
          where: { id: decision.id },
          data: {
            status: "ACCEPTED",
            resolvedAt: new Date(),
            resolvedByUserId: decision.firstResolverUserId,
            resultingEntityId: recoveredEntityId,
          },
        }),
      ]);
      return { done: true as const, result: await recoveredDecision };
    }
    const taskTarget = [
      "create_task",
      "update_task",
      "archive_task",
      "assign_task",
    ].includes(decision.toolName);
    const safelyRetryableJobReservation =
      (decision.toolName === "hire_agent" ||
        decision.toolName === "provide_job_input") &&
      (!existingDelegation || existingDelegation.outcome === "failed");
    if ((taskTarget && !existingDelegation) || safelyRetryableJobReservation) {
      resumeProcessing = true;
    } else {
      throw new SokoBotRuntimeConflictError(
        "Pending decision processing outcome is ambiguous",
      );
    }
  }

  if (
    !isSokoBotDecisionTargetAllowed(
      decision.toolName,
      decision.turn.capabilityNames,
    )
  ) {
    throw new SokoBotRuntimeAuthorizationError(
      "Decision target was not granted for its turn",
    );
  }

  if (scope.network === "preprod" && externalDecision) {
    // The scoped seller, payment and Job input path belongs to ticket 30.
    throw serviceUnavailable("A new Preprod seller request is unavailable", {
      reportToSentry: false,
    });
  }

  if (!resumeProcessing) {
    const claimed = await prisma.sokoBotPendingDecision.updateMany({
      where: { id: decision.id, status: "PENDING" },
      data: { status: "PROCESSING", resolvedByUserId: resolverUserId },
    });
    if (claimed.count === 0) {
      throw new SokoBotRuntimeConflictError(
        "Pending decision was already resolved",
      );
    }
  }
  return {
    done: false as const,
    resolverUserId,
    decisionId,
    accepted,
    ownerConfirmed,
    decision,
    actingUserId,
    decisionToolCallId,
    externalDecision,
    actionContext,
    receiptKey,
    receiptIdentity,
    acknowledgeExternalReceipt,
    resumeProcessing,
  };
}

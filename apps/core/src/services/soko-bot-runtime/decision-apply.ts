import type { Prisma } from "@sokosumi/database";
import { AgentJobStatus } from "@sokosumi/database";
import { createAgentClient } from "@sokosumi/masumi";
import { sokoBotProvideJobInputSchema as provideJobInputSchema } from "@sokosumi/soko-bot";
import { createAgentJobForUser } from "@/helpers/job";
import { sokoBotForTurnMember } from "@/helpers/soko-bot-turn-authority";
import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  decisionProposalTargets,
  parseHireAgentInput,
} from "@/lib/soko-bot/decision-proposal";
import { criteriaForConfirmedSokoBotAction } from "@/services/soko-bot-outcome.service";
import {
  type SokoBotActionContext,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf } from "./acting-scope";
import { type prepareDecision } from "./decision-claim";
import { type RuntimeOperations } from "./operations";
import {
  createSellerReservationMarker,
  persistedErrorDetail,
  type SellerReservationMarker,
  serializeSellerReservationMarker,
} from "./seller-recovery";

export async function applyDecision(
  runtime: RuntimeOperations,
  context: Extract<
    Awaited<ReturnType<typeof prepareDecision>>,
    { done: false }
  >,
) {
  const {
    ownerConfirmed,
    confirmationTurnId,
    decision,
    actingUserId,
    decisionToolCallId,
    externalDecision,
    actionContext,
    receiptKey,
    receiptIdentity,
    acknowledgeExternalReceipt,
  } = context;

  let failureDisposition: "restore" | "retain" = "restore";
  let sellerReservationMarker: SellerReservationMarker | null = null;
  const reserveExternalReceipt = async (tx: Prisma.TransactionClient) => {
    await runtime.requireMutationAuthority(
      tx,
      actionContext,
      ownerConfirmed,
      undefined,
      decision.toolName === "hire_agent" ||
        decision.toolName === "provide_job_input"
        ? decisionProposalTargets(decision.toolName, decision.proposal)
        : {},
    );
    const receipt = await tx.sokoBotToolCall.findUnique({
      where: { turnId_toolCallId: receiptKey },
    });
    if (receipt && receipt.disposition !== "REJECTED") {
      failureDisposition = "retain";
      throw new SokoBotRuntimeConflictError(
        "External decision outcome requires reconciliation before retrying",
      );
    }
    if (receipt) {
      await tx.sokoBotToolCall.update({
        where: { id: receipt.id, disposition: "REJECTED" },
        data: {
          status: "PENDING",
          disposition: "UNKNOWN",
          verification: "NONE",
          committedAt: null,
        },
      });
    } else {
      await tx.sokoBotToolCall.create({
        data: {
          ...receiptIdentity,
          disposition: "UNKNOWN",
          verification: "NONE",
        },
      });
    }
  };
  try {
    const activeBot = await sokoBotForTurnMember(actionContext.turn, "running");
    const workspace = await prisma.workspace.findFirst({
      where: sokoBotWorkspaceAccessWhere(actingUserId, decision.workspaceId),
      select: { id: true, organizationId: true },
    });
    if (!activeBot) {
      throw new SokoBotRuntimeAuthorizationError(
        "Soko Bot is paused or unavailable",
      );
    }
    if (!workspace) {
      throw new SokoBotRuntimeAuthorizationError(
        "Workspace access is no longer available",
      );
    }

    const proposal = decision.proposal as Record<string, unknown>;
    if (ownerConfirmed && decision.intentId) {
      await prisma.sokoBotIntent.update({
        where: { id: decision.intentId },
        data: {
          acceptanceCriteria: criteriaForConfirmedSokoBotAction(
            decision.toolName,
            proposal,
          ),
        },
      });
    }
    let resultingEntityId: string | null = null;
    if (decision.toolName === "hire_agent") {
      const { followUp, ...hire } = parseHireAgentInput(proposal);
      const existingDelegation = await prisma.sokoBotDelegation.findUnique({
        where: {
          turnId_toolCallId: {
            turnId: decision.turnId,
            toolCallId: decisionToolCallId,
          },
        },
        select: { jobId: true, outcome: true, error: true },
      });
      if (existingDelegation?.jobId) {
        await acknowledgeExternalReceipt(existingDelegation.jobId);
        return prisma.sokoBotPendingDecision.update({
          where: { id: decision.id },
          data: {
            status: "ACCEPTED",
            resolvedAt: new Date(),
            resolvedByUserId: decision.firstResolverUserId,
            resultingEntityId: existingDelegation.jobId,
          },
        });
      }
      if (existingDelegation && existingDelegation.outcome !== "failed") {
        failureDisposition = "retain";
        throw new SokoBotRuntimeConflictError(
          "Agent hire is already processing",
        );
      }
      const job = await createAgentJobForUser({
        owner: {
          ownerId: actingUserId,
          organizationId: workspace.organizationId,
          workspaceId: decision.workspaceId,
        },
        creator: { kind: "soko_bot", sokoBotId: decision.sokoBotId },
        agentInput: hire,
        // A bot's Project pays (ADR 0067), whatever Project the hire names; a
        // bot without one leaves the Job's own Project to pay.
        creditProjectId: activeBot.projectId ?? undefined,
        beforeSellerStart: async () => {
          sellerReservationMarker = createSellerReservationMarker(
            "hire_agent",
            decision.proposal,
          );
          const marker = serializeSellerReservationMarker(
            sellerReservationMarker,
          );
          await serializableTransaction(async (tx) => {
            // Same bot-row-first order as administrator PAUSE. Whichever
            // transaction wins determines whether seller dispatch may start.
            await tx.$queryRaw`
                SELECT "id"
                FROM "soko_bot"
                WHERE "id" = ${decision.sokoBotId}::uuid
                FOR UPDATE
              `;
            const activeBot = await sokoBotForTurnMember(
              actionContext.turn,
              "running",
              tx,
            );
            if (!activeBot) {
              throw new SokoBotRuntimeAuthorizationError(
                "Soko Bot is paused or unavailable",
              );
            }
            await reserveExternalReceipt(tx);
            if (existingDelegation?.outcome === "failed") {
              const reserved = await tx.sokoBotDelegation.updateMany({
                where: {
                  turnId: decision.turnId,
                  toolCallId: decisionToolCallId,
                  outcome: "failed",
                  error: existingDelegation.error ?? null,
                },
                data: { outcome: "processing", error: marker },
              });
              if (reserved.count !== 1) {
                failureDisposition = "retain";
                throw new SokoBotRuntimeConflictError(
                  "Agent hire retry was already reserved",
                );
              }
            } else {
              await tx.sokoBotDelegation.create({
                data: {
                  turnId: decision.turnId,
                  toolCallId: decisionToolCallId,
                  kind: "JOB",
                  action: "hire_agent",
                  outcome: "processing",
                  error: marker,
                  followUp,
                },
              });
            }
          }, "Soko Bot hire reservation collided with administrator control");
          // Reservation is durable. Never return this decision to PENDING
          // after crossing into seller-side execution: a retry could create
          // and charge a second Job if the first response was lost.
          failureDisposition = "retain";
        },
        afterSellerStartFailure: async (failure) => {
          const marker = sellerReservationMarker;
          await prisma.sokoBotDelegation.update({
            where: {
              turnId_toolCallId: {
                turnId: decision.turnId,
                toolCallId: decisionToolCallId,
              },
            },
            data: {
              outcome: failure.kind === "unreachable" ? "failed" : "ambiguous",
              error: marker
                ? serializeSellerReservationMarker(
                    marker,
                    new Error(failure.message),
                  )
                : persistedErrorDetail(new Error(failure.message)),
            },
          });
          // Explicit pre-acceptance rejection is safe to retry. Unknown or
          // invalid-success outcomes may already have seller work running.
          failureDisposition =
            failure.kind === "unreachable" ? "restore" : "retain";
          if (failure.kind === "unreachable")
            await prisma.sokoBotToolCall.updateMany({
              where: { ...receiptKey, disposition: "UNKNOWN" },
              data: {
                status: "FAILED",
                disposition: "REJECTED",
                verification: "NONE",
              },
            });
        },
        afterLocalJobCreate: async (job, tx) => {
          const marker = sellerReservationMarker;
          if (!marker) {
            throw new SokoBotRuntimeConflictError(
              "Agent hire reservation is missing",
            );
          }
          const attached = await tx.sokoBotDelegation.updateMany({
            where: {
              turnId: decision.turnId,
              toolCallId: decisionToolCallId,
              outcome: "processing",
              error: serializeSellerReservationMarker(marker),
            },
            data: { outcome: "accepted", jobId: job.id, error: null },
          });
          if (attached.count !== 1) {
            throw new SokoBotRuntimeConflictError(
              "Agent hire reservation changed before local commit",
            );
          }
          await acknowledgeExternalReceipt(job.id, tx);
        },
      });
      resultingEntityId = job.id;
    } else if (decision.toolName === "provide_job_input") {
      const input = provideJobInputSchema.parse(proposal);
      const durableInput = await prisma.jobInput.findUnique({
        where: { eventId: input.eventId },
        select: { id: true },
      });
      if (durableInput) {
        resultingEntityId = durableInput.id;
      } else {
        const event = await prisma.jobEvent.findFirst({
          where: {
            id: input.eventId,
            jobId: input.jobId,
            status: AgentJobStatus.AWAITING_INPUT,
            // Job writes belong to the Owner (ADR 0057): never nobody.
            job: {
              ownerId: actingMemberOf({ turn: { actingUserId } }),
              workspaceId: decision.workspaceId,
            },
          },
          include: {
            input: true,
            job: {
              include: { agent: { include: { metadataOverride: true } } },
            },
          },
        });
        if (!event || event.input || !event.inputSchema) {
          throw new SokoBotRuntimeConflictError(
            "Job no longer awaits this input",
          );
        }
        const existingDelegation = await prisma.sokoBotDelegation.findUnique({
          where: {
            turnId_toolCallId: {
              turnId: decision.turnId,
              toolCallId: decisionToolCallId,
            },
          },
          select: { outcome: true, error: true },
        });
        if (existingDelegation && existingDelegation.outcome !== "failed") {
          failureDisposition = "retain";
          throw new SokoBotRuntimeConflictError(
            "Agent Job input is already processing",
          );
        }
        sellerReservationMarker = createSellerReservationMarker(
          "provide_job_input",
          decision.proposal,
        );
        const marker = serializeSellerReservationMarker(
          sellerReservationMarker,
        );
        await serializableTransaction(async (tx) => {
          await tx.$queryRaw`
              SELECT "id"
              FROM "soko_bot"
              WHERE "id" = ${decision.sokoBotId}::uuid
              FOR UPDATE
            `;
          const activeBot = await sokoBotForTurnMember(
            actionContext.turn,
            "running",
            tx,
          );
          if (!activeBot) {
            throw new SokoBotRuntimeAuthorizationError(
              "Soko Bot is paused or unavailable",
            );
          }
          await reserveExternalReceipt(tx);
          if (existingDelegation?.outcome === "failed") {
            const reserved = await tx.sokoBotDelegation.updateMany({
              where: {
                turnId: decision.turnId,
                toolCallId: decisionToolCallId,
                outcome: "failed",
                error: existingDelegation.error ?? null,
              },
              data: { outcome: "processing", error: marker },
            });
            if (reserved.count !== 1) {
              failureDisposition = "retain";
              throw new SokoBotRuntimeConflictError(
                "Agent Job input retry was already reserved",
              );
            }
          } else {
            await tx.sokoBotDelegation.create({
              data: {
                turnId: decision.turnId,
                toolCallId: decisionToolCallId,
                kind: "JOB",
                action: "provide_job_input",
                outcome: "processing",
                jobId: event.job.id,
                error: marker,
              },
            });
          }
        }, "Soko Bot input reservation collided with administrator control");
        // provide_input has no idempotency key. Only explicit rejection may
        // reopen the decision; every other failure remains durably fenced.
        failureDisposition = "retain";
        const result = await createAgentClient().provideJobInput(
          {
            id: event.job.agent.id,
            name: event.job.agent.name,
            blockchainIdentifier:
              event.job.agentBlockchainIdentifier ??
              event.job.agent.blockchainIdentifier,
            apiBaseUrl:
              event.job.agentApiBaseUrl ?? event.job.agent.apiBaseUrl ?? "",
          },
          event.job.agentJobId,
          event.inputSchema,
          input.inputData,
        );
        if (result.isErr()) {
          await prisma.sokoBotDelegation.update({
            where: {
              turnId_toolCallId: {
                turnId: decision.turnId,
                toolCallId: decisionToolCallId,
              },
            },
            data: {
              outcome:
                result.error.kind === "unreachable" ? "failed" : "ambiguous",
              error: serializeSellerReservationMarker(
                sellerReservationMarker,
                new Error(result.error.message),
              ),
            },
          });
          failureDisposition =
            result.error.kind === "unreachable" ? "restore" : "retain";
          if (result.error.kind === "unreachable")
            await prisma.sokoBotToolCall.updateMany({
              where: { ...receiptKey, disposition: "UNKNOWN" },
              data: {
                status: "FAILED",
                disposition: "REJECTED",
                verification: "NONE",
              },
            });
          throw new SokoBotRuntimeValidationError(result.error.message);
        }
        try {
          const jobInput = await prisma.jobInput.create({
            data: {
              eventId: event.id,
              input: JSON.stringify(input.inputData),
              inputHash: result.value.input_hash,
              signature: result.value.signature,
            },
          });
          resultingEntityId = jobInput.id;
        } catch (error) {
          const recoveredInput = await prisma.jobInput.findUnique({
            where: { eventId: event.id },
            select: { id: true },
          });
          if (recoveredInput) {
            resultingEntityId = recoveredInput.id;
          } else {
            await prisma.sokoBotDelegation.update({
              where: {
                turnId_toolCallId: {
                  turnId: decision.turnId,
                  toolCallId: decisionToolCallId,
                },
              },
              data: {
                outcome: "ambiguous",
                error: serializeSellerReservationMarker(
                  sellerReservationMarker,
                  error,
                ),
              },
            });
            throw error;
          }
        }
        await prisma.sokoBotDelegation.update({
          where: {
            turnId_toolCallId: {
              turnId: decision.turnId,
              toolCallId: decisionToolCallId,
            },
          },
          data: { outcome: "accepted", error: null },
        });
      }
    } else if (decision.toolName === "create_task") {
      const authorized: SokoBotActionContext = {
        confirmationTurnId,
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
      const task = await runtime.createTask(
        authorized,
        proposal,
        `decision:${decision.id}`,
        true,
      );
      resultingEntityId = task.id;
    } else if (
      decision.toolName === "update_task" ||
      decision.toolName === "archive_task"
    ) {
      const updated = await runtime.mutateTask(
        {
          confirmationTurnId,
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
        },
        proposal,
        `decision:${decision.id}`,
        { capability: decision.toolName, approved: true },
      );
      // An approved call skips the gate that asks for approval.
      if ("approvalRequired" in updated)
        throw new SokoBotRuntimeConflictError(
          "An approved Task change asked for approval again",
        );
      resultingEntityId = updated.id;
    } else if (decision.toolName === "assign_task") {
      const updated = await runtime.assignTask(
        {
          confirmationTurnId,
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
        },
        proposal,
        `decision:${decision.id}`,
        true,
      );
      resultingEntityId = updated.id;
    }

    if (externalDecision && resultingEntityId)
      await acknowledgeExternalReceipt(resultingEntityId);
    if (decision.intentId)
      await prisma.sokoBotIntent.update({
        where: { id: decision.intentId },
        data: {
          state: "IN_PROGRESS",
          evidenceIds: resultingEntityId ? [resultingEntityId] : [],
        },
      });
    return await prisma.sokoBotPendingDecision.update({
      where: { id: decision.id },
      data: {
        status: "ACCEPTED",
        resolvedAt: new Date(),
        resolvedByUserId: decision.firstResolverUserId,
        resultingEntityId,
      },
    });
  } catch (error) {
    if (failureDisposition === "restore") {
      await prisma.sokoBotPendingDecision.updateMany({
        where: { id: decision.id, status: "PROCESSING" },
        data: { status: "PENDING", resolvedByUserId: null },
      });
    } else {
      await prisma.sokoBotDelegation.updateMany({
        where: {
          turnId: decision.turnId,
          toolCallId: decisionToolCallId,
          outcome: "processing",
        },
        data: {
          outcome: "ambiguous",
          error: sellerReservationMarker
            ? serializeSellerReservationMarker(sellerReservationMarker, error)
            : persistedErrorDetail(error),
        },
      });
    }
    throw error;
  }
}

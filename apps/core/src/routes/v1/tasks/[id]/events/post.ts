import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { Prisma, TaskStatus } from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  convertCentsToCredits,
  convertCreditsToCents,
  userTaskStatusTransitionRequiresComment,
} from "@sokosumi/utils";

import { waitUntil } from "@vercel/functions";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import {
  requireTaskCancelAccess,
  requireTaskCollaboration,
  requireTaskCommentAccess,
} from "@/helpers/access-control";
import {
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
  isCardanoV2SourceReady,
} from "@/helpers/agent";
import { calculateCentsFromMasumiAmountStrings } from "@/helpers/agent-cost";
import {
  conflict,
  errorResponseWithExtensionsSchema,
  unprocessableEntity,
} from "@/helpers/error";
import { isV2MasumiTaskPayment } from "@/helpers/masumi-task-payment";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { isBlockchainIdentifierUniqueConstraintError } from "@/helpers/prisma";
import { created, unprocessableWithData } from "@/helpers/response";
import {
  type CascadedCancelChild,
  cascadeCancelNonTerminalScheduleRuns,
  mapTaskEvent,
  taskEventApiInclude,
  validateStatusTransition,
  validateTaskAssigneeAssignment,
} from "@/helpers/task";
import {
  applyGuardedTaskStatusUpdate,
  chargeTaskCreditsOrMarkOutOfCredits,
} from "@/helpers/task-event-charge";
import { notifyTaskStatusEvent } from "@/helpers/task-notifications";
import { removeTaskSchedulePlannedOccurrences } from "@/helpers/task-schedule-occurrence-index";
import { publishTaskEventData } from "@/lib/ably/publish";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type AuthenticationContext,
  isAgentAuthContext,
  isCoworkerAuthContext,
  isSokoBotAuthContext,
  isUserAuthContext,
  requireUserContext,
} from "@/middleware/auth";
import { taskEventSchema } from "@/schemas/task.schema";
import { projectMemoryService } from "@/services/project-memory.service";
import { sourceImportService } from "@/services/source-import.service";
import {
  createTaskPaymentClaim,
  processTaskPaymentClaim,
} from "@/services/task-payment-claim.service";

import { createTaskEventRequestSchema } from "./schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

function getStatusEventActorData(authContext: AuthenticationContext) {
  if (isUserAuthContext(authContext)) {
    return {
      userId: authContext.userId,
      coworkerId: null,
      sokoBotId: null,
    };
  }

  if (isSokoBotAuthContext(authContext)) {
    return {
      userId: null,
      coworkerId: null,
      sokoBotId: authContext.sokoBotId,
    };
  }

  // Status transitions from a delegated coworker are attributed to the acting
  // coworker only. Context userId is workspace context, not a second actor FK.
  return {
    userId: null,
    coworkerId: authContext.coworkerId,
    sokoBotId: null,
  };
}

function getCommentEventActorData(authContext: AuthenticationContext) {
  if (isUserAuthContext(authContext)) {
    return {
      userId: authContext.userId,
      coworkerId: null,
      sokoBotId: null,
    };
  }

  if (isSokoBotAuthContext(authContext)) {
    return {
      userId: null,
      coworkerId: null,
      sokoBotId: authContext.sokoBotId,
    };
  }

  // Coworker comments are shown by coworkerId in the UI; userId is not used.
  return {
    userId: null,
    coworkerId: authContext.coworkerId,
    sokoBotId: null,
  };
}

function getAgentActorData(authContext: AuthenticationContext) {
  if (isSokoBotAuthContext(authContext)) {
    return {
      userId: null,
      coworkerId: null,
      sokoBotId: authContext.sokoBotId,
    };
  }

  if (!isCoworkerAuthContext(authContext)) {
    throw new Error("getAgentActorData called without agent auth context");
  }
  return {
    userId: null,
    coworkerId: authContext.coworkerId,
    sokoBotId: null,
  };
}

interface SettleTaskEventChargeParams {
  task: {
    ownerId: string;
    organizationId: string | null;
    status: TaskStatus;
  };
  credits?: number | null;
  masumiPayment?: z.infer<
    ReturnType<typeof createTaskEventRequestSchema>
  >["masumiPayment"];
  tx: Prisma.TransactionClient;
}

interface SettleTaskEventChargeResult {
  cents: bigint | undefined;
  transactionId: string | null;
  /** When set, charge failed for balance and status was replaced. */
  eventStatus: TaskStatus | null;
  chargedMasumiPayment: boolean;
}

async function settleTaskEventCharge({
  task,
  credits,
  masumiPayment,
  tx,
}: SettleTaskEventChargeParams): Promise<SettleTaskEventChargeResult> {
  if (masumiPayment) {
    console.info("[tasks] masumi task payment: using masumiPayment", {
      masumiPayment,
    });
    // V2 payments are gated exactly like the job flow: a payment node that
    // recently reported the payload's EXACT policy/contract source as
    // purchase-ready. Rejecting before the charge avoids a pointless
    // debit/refund cycle; unexpected node rejection is compensated below.
    const isV2TaskPayment = isV2MasumiTaskPayment(masumiPayment);
    if (isV2TaskPayment) {
      const readySources = await getCardanoV2ReadySources(tx);
      if (readySources.length === 0) {
        throw unprocessableEntity(
          "Cardano V2 payments are not enabled on this deployment",
        );
      }
      const paymentSource = masumiPayment.PaymentSource;
      if (!paymentSource) {
        throw unprocessableEntity(
          "V2 masumi payments must include PaymentSource with the seller's policyId and smartContractAddress",
        );
      }
      // Same matcher as the job flow. isCardanoV2SourceReady lowercases both
      // sides, so a mixed-case address or identifier from the node still
      // matches a purchase-ready source.
      const isSourceReady = isCardanoV2SourceReady(
        masumiPayment.agentIdentifier,
        paymentSource.smartContractAddress,
        readySources,
      );
      if (!isSourceReady) {
        throw unprocessableEntity(
          "The selected Cardano V2 payment source is not purchase-ready on this deployment",
        );
      }
    }
    const creditCosts = await getCreditCostsOrThrow(tx);
    const cents = calculateCentsFromMasumiAmountStrings(
      masumiPayment.Amounts,
      creditCosts,
    );
    if (cents === 0n) {
      throw unprocessableEntity(
        `Credit amount rounds to zero; minimum chargeable amount is ${LIMITS.MIN_CHARGEABLE_CREDITS} credits`,
      );
    }
    const creditsValue = convertCentsToCredits(cents);
    if (creditsValue < LIMITS.MIN_CHARGEABLE_CREDITS) {
      throw unprocessableEntity(
        `Credit amount is below the minimum chargeable value (${LIMITS.MIN_CHARGEABLE_CREDITS})`,
      );
    }
    const charge = await chargeTaskCreditsOrMarkOutOfCredits({
      userId: task.ownerId,
      organizationId: task.organizationId,
      cents,
      currentStatus: task.status,
      tx,
    });
    if (charge.eventStatus != null) {
      return {
        cents,
        transactionId: null,
        eventStatus: charge.eventStatus,
        chargedMasumiPayment: false,
      };
    }
    return {
      cents,
      transactionId: charge.transactionId,
      eventStatus: null,
      chargedMasumiPayment: true,
    };
  }

  if (credits != null && credits > 0) {
    const cents = convertCreditsToCents(credits);
    if (cents === 0n) {
      throw unprocessableEntity(
        `Credit amount rounds to zero; minimum chargeable amount is ${LIMITS.MIN_CHARGEABLE_CREDITS} credits`,
      );
    }
    const charge = await chargeTaskCreditsOrMarkOutOfCredits({
      userId: task.ownerId,
      organizationId: task.organizationId,
      cents,
      currentStatus: task.status,
      tx,
    });
    if (charge.eventStatus != null) {
      return {
        cents,
        transactionId: null,
        eventStatus: charge.eventStatus,
        chargedMasumiPayment: false,
      };
    }
    return {
      cents,
      transactionId: charge.transactionId,
      eventStatus: null,
      chargedMasumiPayment: false,
    };
  }

  return {
    cents: undefined,
    transactionId: null,
    eventStatus: null,
    chargedMasumiPayment: false,
  };
}

async function mapCreatedTaskEventForResponse(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<ReturnType<typeof mapTaskEvent>> {
  const row = await tx.taskEvent.findUnique({
    where: { id: eventId },
    include: taskEventApiInclude,
  });
  if (!row) {
    throw new Error(`Task event not found after create: ${eventId}`);
  }
  return mapTaskEvent(row);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  const taskEventRequestBodySchema = createTaskEventRequestSchema({
    serverNetwork: getEnv().NETWORK,
  });

  const route = createRoute({
    method: "post",
    path: "/{id}/events",
    description: "Create task event",
    tags: ["Tasks"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: taskEventRequestBodySchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(taskEventSchema, "Create task event"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: {
        description:
          "Unprocessable Entity. Mid-run insufficient balance pauses the task to OUT_OF_CREDITS; `data` is that event and `kind` is insufficient_balance.",
        content: {
          "application/json": {
            schema: errorResponseWithExtensionsSchema({
              data: taskEventSchema.optional(),
              attemptedCredits: z.number().optional().openapi({ example: 2 }),
              requestedStatus: z.enum(TaskStatus).nullable().optional(),
            }),
          },
        },
      },
      500: jsonErrorResponse("Internal Server Error"),
    },
  });

  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: taskId } = c.req.valid("param");
    const body = c.req.valid("json");

    const transactionResult = await serializableTransaction(async (tx) => {
      const { status, credits, authenticationUrl, channel, masumiPayment } =
        body;
      let comment = body.comment;

      const hasNonCommentWrite =
        status !== undefined ||
        credits != null ||
        authenticationUrl != null ||
        masumiPayment != null;

      const isCancelOnlyWrite =
        status === TaskStatus.CANCELED &&
        credits == null &&
        authenticationUrl == null &&
        masumiPayment == null;

      const task = isCancelOnlyWrite
        ? await requireTaskCancelAccess(c.var, taskId, tx)
        : hasNonCommentWrite
          ? await requireTaskCollaboration(authContext, taskId, tx)
          : await requireTaskCommentAccess(c.var, taskId, tx);

      const isAgent = isAgentAuthContext(authContext);

      if (!isCancelOnlyWrite) {
        const assignedSeatUserId = isAgent
          ? task.ownerId
          : requireUserContext(authContext).userId;
        await requireAssignedOrganizationSeat(
          assignedSeatUserId,
          task.organizationId,
          tx,
        );
      }

      if (!isAgent && credits != null) {
        throw unprocessableEntity(
          "Only the assigned coworker can set credits on task events",
        );
      }

      if (!isAgent && masumiPayment != null) {
        throw unprocessableEntity(
          "Only the assigned coworker can set masumiPayment on task events",
        );
      }

      if (
        status === undefined &&
        comment === undefined &&
        credits == null &&
        masumiPayment == null
      ) {
        throw unprocessableEntity(
          "At least one of status, comment, credits, or masumiPayment is required",
        );
      }

      if (status !== undefined) {
        validateStatusTransition(authContext, task.status, status);
        validateTaskAssigneeAssignment({
          status,
          assigneeId: task.assigneeId,
          assigneeSokoBotId: task.assigneeSokoBotId,
        });

        if (
          !isAgent &&
          userTaskStatusTransitionRequiresComment(task.status, status)
        ) {
          const trimmedComment = comment?.trim();
          if (!trimmedComment) {
            throw unprocessableEntity(
              "A comment is required when reopening a canceled or completed task to ready",
            );
          }
          comment = trimmedComment;
        }
      }

      let cents: bigint | undefined;
      let transactionId: string | null = null;
      let eventStatus: TaskStatus | null = status ?? null;
      let chargedMasumiPayment = false;
      let pausedForInsufficientBalance = false;
      let cascadedChildren: CascadedCancelChild[] = [];

      if (
        isAgent &&
        (masumiPayment != null || (credits != null && credits > 0))
      ) {
        const settled = await settleTaskEventCharge({
          task,
          credits,
          masumiPayment,
          tx,
        });
        cents = settled.cents;
        transactionId = settled.transactionId;
        chargedMasumiPayment = settled.chargedMasumiPayment;
        if (settled.eventStatus != null) {
          eventStatus = settled.eventStatus;
          pausedForInsufficientBalance =
            settled.eventStatus === TaskStatus.OUT_OF_CREDITS;
        }
      }

      const actorData =
        status !== undefined || eventStatus === TaskStatus.OUT_OF_CREDITS
          ? await getStatusEventActorData(authContext)
          : credits != null || masumiPayment != null
            ? getAgentActorData(authContext)
            : await getCommentEventActorData(authContext);

      const createdEvent = await tx.taskEvent.create({
        data: {
          taskId,
          status: eventStatus,
          comment,
          authenticationUrl,
          channel,
          cents,
          transactionId,
          ...actorData,
        },
      });

      let taskPaymentClaimId: string | null = null;
      if (chargedMasumiPayment && masumiPayment !== undefined) {
        if (!transactionId) {
          throw new Error("Charged Masumi task payment has no transaction");
        }
        taskPaymentClaimId = await createTaskPaymentClaim({
          network: getEnv().NETWORK,
          // Dedupe key only. Lowercased so the (network, blockchainIdentifier)
          // unique index catches a resubmission that differs solely in casing
          // — without it that payment would claim a second row, and the outbox
          // would place a second purchase for work already paid for. The
          // payload below deliberately keeps the seller's original casing,
          // which is what the node is sent.
          blockchainIdentifier:
            masumiPayment.blockchainIdentifier.toLowerCase(),
          purchasePayload: {
            blockchainIdentifier: masumiPayment.blockchainIdentifier,
            agentIdentifier: masumiPayment.agentIdentifier,
            sellerVkey: masumiPayment.sellerVkey,
            submitResultTime: masumiPayment.submitResultTime,
            payByTime: masumiPayment.payByTime,
            unlockTime: masumiPayment.unlockTime,
            externalDisputeUnlockTime: masumiPayment.externalDisputeUnlockTime,
            inputHash: masumiPayment.inputHash,
            Amounts: masumiPayment.Amounts,
            identifierFromPurchaser: masumiPayment.identifierFromPurchaser,
            paymentSourceType: masumiPayment.paymentSourceType,
            smartContractAddress: isV2MasumiTaskPayment(masumiPayment)
              ? masumiPayment.PaymentSource?.smartContractAddress
              : undefined,
            supportedPaymentSourceIndex: isV2MasumiTaskPayment(masumiPayment)
              ? masumiPayment.supportedPaymentSourceIndex
              : undefined,
            metadata: JSON.stringify({
              taskId,
              taskEventId: createdEvent.id,
            }),
          },
          taskEventId: createdEvent.id,
          transactionId,
          tx,
        });
      }

      // Update task when the caller requested a status change, or when a
      // failed charge replaced the outcome with OUT_OF_CREDITS (incl.
      // credit-only bodies that had no status).
      if (eventStatus != null) {
        await applyGuardedTaskStatusUpdate({
          tx,
          taskId,
          expectedStatus: task.status,
          eventStatus,
        });

        if (
          task.status === TaskStatus.QUEUED &&
          eventStatus !== TaskStatus.QUEUED
        ) {
          await removeTaskSchedulePlannedOccurrences(tx, taskId);
        }

        if (eventStatus === TaskStatus.CANCELED) {
          cascadedChildren = await cascadeCancelNonTerminalScheduleRuns({
            tx,
            parentTaskId: taskId,
            actorData,
          });
        }
      }

      const payment =
        chargedMasumiPayment && masumiPayment !== undefined
          ? masumiPayment
          : null;

      // Enqueue PENDING task-output files from comment (in-transaction for durability)
      if (comment) {
        await sourceImportService.enqueueTaskOutputsFromMarkdown(
          taskId,
          comment,
          tx,
        );
      }

      return {
        event: await mapCreatedTaskEventForResponse(tx, createdEvent.id),
        userId: task.ownerId,
        projectId: task.projectId,
        masumiPayment: payment,
        taskPaymentClaimId,
        pausedForInsufficientBalance,
        cascadedChildTaskIds: cascadedChildren,
      };
    }, "Task changed by a concurrent request. Please retry.").catch((error) => {
      if (
        body.masumiPayment &&
        isBlockchainIdentifierUniqueConstraintError(error)
      ) {
        throw conflict(
          "A task payment with this blockchainIdentifier already exists",
        );
      }
      throw error;
    });
    const {
      event,
      userId,
      projectId,
      masumiPayment,
      taskPaymentClaimId,
      pausedForInsufficientBalance,
      cascadedChildTaskIds,
    } = transactionResult;

    if (event.status === TaskStatus.COMPLETED && projectId) {
      waitUntil(
        projectMemoryService
          .refreshAfterTaskCompleted({ projectId, taskId })
          .catch((error) => {
            console.error("Project memory refresh failed", {
              projectId,
              taskId,
              error,
            });
            Sentry.captureException(error, {
              tags: { error_type: "project_memory_refresh_failed" },
              extra: { projectId, taskId },
            });
          }),
      );
    }

    if (event.status) {
      waitUntil(notifyTaskStatusEvent(taskId, event.id, event.status));
    }

    // Unreachable by construction (a charged payment always writes its claim
    // in the same transaction). Never throw on it: the event and its debit are
    // already committed, so throwing would answer 500 for work that succeeded.
    if (masumiPayment != null && !taskPaymentClaimId) {
      console.error("[tasks] masumi task payment: no durable claim", {
        taskId,
        taskEventId: event.id,
        blockchainIdentifier: masumiPayment.blockchainIdentifier,
      });
      Sentry.captureMessage("Masumi task payment has no durable claim", {
        level: "error",
        tags: { error_type: "task_payment_claim_missing" },
        extra: {
          taskId,
          taskEventId: event.id,
          blockchainIdentifier: masumiPayment.blockchainIdentifier,
        },
      });
    }

    if (masumiPayment != null && taskPaymentClaimId) {
      const taskEventId = event.id;

      Sentry.addBreadcrumb({
        category: "task_masumi_purchase",
        message: "Scheduling task purchase (async)",
        level: "info",
        data: {
          taskId,
          taskEventId,
          blockchainIdentifier: masumiPayment.blockchainIdentifier,
        },
      });

      console.info("[tasks] masumi task payment: scheduling async purchase", {
        taskId,
        taskEventId,
        blockchainIdentifier: masumiPayment.blockchainIdentifier,
        agentIdentifier: masumiPayment.agentIdentifier,
      });

      const masumiPurchasePromise = (async () => {
        try {
          const result = await processTaskPaymentClaim(taskPaymentClaimId);
          if (result.status === "purchased") {
            console.info("[tasks] masumi task payment: purchase created", {
              taskId,
              taskEventId,
              purchaseId: result.purchaseId,
              blockchainIdentifier: masumiPayment.blockchainIdentifier,
            });
            Sentry.addBreadcrumb({
              category: "task_masumi_purchase",
              message: "Task purchase created",
              level: "info",
              data: { taskId, purchaseId: result.purchaseId },
            });
            return;
          }
          if (result.status === "refunded") {
            Sentry.captureMessage(
              `Task purchase permanently rejected: ${result.reason}`,
              {
                level: "error",
                tags: {
                  error_type: "task_purchase_permanent_failure",
                  compensated: String(result.compensated),
                },
                extra: {
                  taskId,
                  taskEventId,
                  claimId: taskPaymentClaimId,
                  blockchainIdentifier: masumiPayment.blockchainIdentifier,
                },
              },
            );
            return;
          }
          if (result.status === "retry_scheduled") {
            console.warn("[tasks] masumi task payment: retry scheduled", {
              taskId,
              taskEventId,
              claimId: taskPaymentClaimId,
              reason: result.reason,
            });
          }
        } catch (error) {
          // Durable PENDING claim remains recoverable by cron. Never refund an
          // ambiguous branch: remote purchase may already exist.
          console.error("[tasks] masumi task payment: processor failed", {
            taskId,
            taskEventId,
            claimId: taskPaymentClaimId,
            blockchainIdentifier: masumiPayment.blockchainIdentifier,
            error,
          });
          Sentry.captureException(error, {
            tags: { error_type: "task_purchase_processor_failed" },
            extra: { taskId, taskEventId, claimId: taskPaymentClaimId },
          });
        }
      })();

      waitUntil(masumiPurchasePromise);
    }

    const taskIdsToPublish = [
      { userId, taskId },
      ...cascadedChildTaskIds.map((child) => ({
        userId: child.userId,
        taskId: child.taskId,
      })),
    ];

    await Promise.all(
      taskIdsToPublish.map(
        async ({ userId: publishUserId, taskId: publishTaskId }) => {
          try {
            await publishTaskEventData({
              userId: publishUserId,
              taskId: publishTaskId,
              eventType: "task_event",
            });
          } catch (error) {
            Sentry.captureException(error, {
              tags: {
                error_type: "publish_task_event",
              },
              extra: {
                taskId: publishTaskId,
                userId: publishUserId,
              },
            });
          }
        },
      ),
    );

    const parsedEvent = taskEventSchema.parse(event);

    // Charge failed but OUT_OF_CREDITS pause was committed — not what the
    // requester asked to create, so 422 with the pause event in `data`.
    if (pausedForInsufficientBalance) {
      return unprocessableWithData(c, parsedEvent, {
        message: "Insufficient balance",
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
        attemptedCredits: parsedEvent.credits ?? undefined,
        requestedStatus: body.status ?? null,
      });
    }

    return created(c, parsedEvent);
  });
}

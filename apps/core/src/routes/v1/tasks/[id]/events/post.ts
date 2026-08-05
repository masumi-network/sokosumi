import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { NotificationKind, Prisma, TaskStatus } from "@sokosumi/database";
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
  calculateCentsFromMasumiAmountStrings,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
  isCardanoV2SourceReady,
} from "@/helpers/agent";
import {
  badRequest,
  conflict,
  errorResponseWithExtensionsSchema,
  unprocessableEntity,
} from "@/helpers/error";
import { isV2MasumiTaskPayment } from "@/helpers/masumi-task-payment";
import { createNotification } from "@/helpers/notifications";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireOrchestratorIdForAttribution } from "@/helpers/orchestrator-instance";
import { isBlockchainIdentifierUniqueConstraintError } from "@/helpers/prisma";
import { created, unprocessableWithData } from "@/helpers/response";
import {
  type CascadedCancelChild,
  cascadeCancelNonTerminalScheduleRuns,
  getTaskStatusUpdateDataForEvent,
  mapTaskEvent,
  taskEventApiInclude,
  validateStatusTransition,
  validateTaskAssigneeAssignment,
} from "@/helpers/task";
import {
  createTaskEventTransaction,
  isInsufficientBalanceError,
} from "@/helpers/task-credits";
import { publishTaskEventData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type AuthenticationContext,
  isCoworkerAgentContext,
  isCoworkerAuthContext,
  isOrchestratorAuthContext,
  isUserAuthContext,
} from "@/middleware/auth";
import { taskEventSchema } from "@/schemas/task.schema";
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

/**
 * Orchestrator status/comment attribution uses only `orchestratorId`.
 * Context userId is workspace scope, not a second actor FK.
 * Fail closed when the service token has context but no active instance
 * (same rule as task create). Re-reads at write time so concurrent purge
 * cannot attribute via a stale middleware snapshot.
 */
async function getOrchestratorEventActorData(
  authContext: AuthenticationContext,
) {
  if (!isOrchestratorAuthContext(authContext)) {
    throw badRequest(
      "Active orchestrator instance required (bind X-Context-User-Id)",
    );
  }

  return {
    userId: null,
    coworkerId: null,
    orchestratorId: await requireOrchestratorIdForAttribution(authContext),
  };
}

async function getStatusEventActorData(authContext: AuthenticationContext) {
  if (isUserAuthContext(authContext)) {
    return {
      userId: authContext.userId,
      coworkerId: null,
      orchestratorId: null,
    };
  }

  if (isOrchestratorAuthContext(authContext)) {
    return getOrchestratorEventActorData(authContext);
  }

  // Status transitions from a delegated coworker are attributed to the acting
  // coworker only. Context userId is workspace context, not a second actor FK.
  return {
    userId: null,
    coworkerId: authContext.coworkerId,
    orchestratorId: null,
  };
}

async function getCommentEventActorData(authContext: AuthenticationContext) {
  if (isUserAuthContext(authContext)) {
    return {
      userId: authContext.userId,
      coworkerId: null,
      orchestratorId: null,
    };
  }

  if (isOrchestratorAuthContext(authContext)) {
    return getOrchestratorEventActorData(authContext);
  }

  // Coworker comments are shown by coworkerId in the UI; userId is not used.
  return {
    userId: null,
    coworkerId: authContext.coworkerId,
    orchestratorId: null,
  };
}

/** Attribution only — credit auth is enforced at the route gate (`isAgent`). */
function getCoworkerActorData(authContext: AuthenticationContext) {
  if (!isCoworkerAuthContext(authContext)) {
    throw new Error(
      "getCoworkerActorData called without coworker auth context",
    );
  }

  return {
    userId: null,
    coworkerId: authContext.coworkerId,
    orchestratorId: null,
  };
}

/** Statuses that may be paused to OUT_OF_CREDITS on insufficient balance. */
const OUT_OF_CREDITS_PAUSE_STATUSES = new Set<TaskStatus>([
  TaskStatus.DRAFT,
  TaskStatus.QUEUED,
  TaskStatus.READY,
  TaskStatus.GRANT_PENDING,
  TaskStatus.INPUT_REQUIRED,
  TaskStatus.APPROVAL_REQUIRED,
  TaskStatus.AUTHENTICATION_REQUIRED,
  TaskStatus.CREDITS_TOPPED_UP,
  TaskStatus.RUNNING,
  TaskStatus.AWAITING_EXTERNAL,
]);

async function chargeTaskCreditsOrMarkOutOfCredits(params: {
  userId: string;
  organizationId: string | null;
  cents: bigint;
  currentStatus: TaskStatus;
  tx: Prisma.TransactionClient;
}): Promise<{
  transactionId: string | null;
  /** When set, the billed status was rejected for balance and replaced. */
  eventStatus: TaskStatus | null;
}> {
  try {
    const transactionId = await createTaskEventTransaction({
      userId: params.userId,
      organizationId: params.organizationId,
      cents: params.cents,
      tx: params.tx,
    });
    return { transactionId, eventStatus: null };
  } catch (error) {
    // Terminal tasks (COMPLETED/FAILED/CANCELED) and already-OUT_OF_CREDITS keep
    // their status — rethrow as 422. Only mid-run tasks pause to OUT_OF_CREDITS.
    if (
      !isInsufficientBalanceError(error) ||
      !OUT_OF_CREDITS_PAUSE_STATUSES.has(params.currentStatus)
    ) {
      throw error;
    }
    // Route persists OUT_OF_CREDITS then returns 422 with that event in `data`
    // (not 201 — the requested billed status did not land).
    return { transactionId: null, eventStatus: TaskStatus.OUT_OF_CREDITS };
  }
}

/**
 * Upper bound on a single task-event charge.
 *
 * The amount is chosen by the assigned coworker, and this flow has no
 * caller-supplied ceiling like the hire flow's `maxAcceptedCents` — so an
 * unbounded charge would let one event empty the owner's balance. Report it:
 * a breach is a compromised or misbehaving coworker, not user error.
 */
function assertTaskEventChargeWithinCeiling(creditsValue: number): void {
  if (creditsValue <= LIMITS.MAX_TASK_EVENT_CREDITS) {
    return;
  }
  Sentry.captureMessage("Task event charge exceeded the per-event ceiling", {
    level: "error",
    tags: { error_type: "task_event_charge_ceiling_exceeded" },
    extra: {
      attemptedCredits: creditsValue,
      ceiling: LIMITS.MAX_TASK_EVENT_CREDITS,
    },
  });
  throw unprocessableEntity(
    `Credit amount exceeds the maximum chargeable value for a single task event (${LIMITS.MAX_TASK_EVENT_CREDITS})`,
  );
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
    // Log identifiers, not the payload: the full object carries the seller
    // vkey, amounts, and deadlines into retained logs for every charge.
    console.info("[tasks] masumi task payment: using masumiPayment", {
      blockchainIdentifier: masumiPayment.blockchainIdentifier,
      agentIdentifier: masumiPayment.agentIdentifier,
      paymentSourceType: masumiPayment.paymentSourceType,
    });
    // V2 payments are gated exactly like the job flow: rollout flag AND a
    // payment node that recently reported the payload's EXACT policy/contract
    // source as purchase-ready. Rejecting before the charge avoids a pointless
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
      // Use the SAME matcher as the job flow. A local copy previously compared
      // a lowercased payload address against the stored address verbatim —
      // only the policy id is normalized on the way into the cache — so a
      // mixed-case address from the node rejected a genuinely ready source.
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
    assertTaskEventChargeWithinCeiling(creditsValue);
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
    assertTaskEventChargeWithinCeiling(credits);
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

async function dispatchTaskNotification(
  task: {
    id: string;
    ownerId: string;
    name: string | null;
    assignee: { name: string } | null;
    project: { name: string } | null;
    projectId: string | null;
    workspaceId: string | null;
    owner: { notificationsOptIn: boolean };
  },
  eventId: string,
  status: string,
): Promise<void> {
  if (!task.owner.notificationsOptIn) {
    return;
  }

  try {
    let messageKey: string;
    switch (status) {
      case "INPUT_REQUIRED":
        messageKey = "Notifications.Task.inputRequired";
        break;
      case "APPROVAL_REQUIRED":
        messageKey = "Notifications.Task.approvalRequired";
        break;
      case "AUTHENTICATION_REQUIRED":
        messageKey = "Notifications.Task.authenticationRequired";
        break;
      case "OUT_OF_CREDITS":
        messageKey = "Notifications.Task.outOfCredits";
        break;
      case "COMPLETED":
        messageKey = "Notifications.Task.completed";
        break;
      case "FAILED":
        messageKey = "Notifications.Task.failed";
        break;
      case "CANCELED":
        messageKey = "Notifications.Task.canceled";
        break;
      default:
        return;
    }

    const taskName = task.name ?? "Untitled task";
    const coworkerName = task.assignee?.name ?? "Assistant";
    const projectName = task.project?.name;

    const messageParams: Record<string, unknown> = {
      coworkerName,
      taskName,
    };

    if (projectName) {
      messageParams.projectName = projectName;
    }

    const metadata: Record<string, unknown> = {};
    if (task.projectId) {
      metadata.projectId = task.projectId;
    }
    if (task.workspaceId) {
      metadata.workspaceId = task.workspaceId;
    }

    await createNotification({
      userId: task.ownerId,
      kind: NotificationKind.TASK,
      referenceId: task.id,
      eventId,
      messageKey,
      messageParams,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        taskId: task.id,
        userId: task.ownerId,
        notificationType: "task-notification",
      },
    });
  }
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

      const isAgent = isCoworkerAgentContext(authContext);

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
            ? getCoworkerActorData(authContext)
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
          blockchainIdentifier: masumiPayment.blockchainIdentifier,
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
        const updateResult = await tx.task.updateMany({
          where: { id: taskId, status: task.status },
          data: getTaskStatusUpdateDataForEvent(eventStatus),
        });
        if (updateResult.count !== 1) {
          throw conflict("Task status was changed by another request");
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

      return {
        event: await mapCreatedTaskEventForResponse(tx, createdEvent.id),
        userId: task.ownerId,
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
      masumiPayment,
      taskPaymentClaimId,
      pausedForInsufficientBalance,
      cascadedChildTaskIds,
    } = transactionResult;

    if (event.status) {
      const taskEventId = event.id;
      const taskEventStatus = event.status;

      waitUntil(
        (async () => {
          try {
            const taskWithRelations = await prisma.task.findUnique({
              where: { id: taskId },
              select: {
                id: true,
                ownerId: true,
                name: true,
                projectId: true,
                workspaceId: true,
                assignee: {
                  select: {
                    name: true,
                  },
                },
                project: {
                  select: {
                    name: true,
                  },
                },
                owner: {
                  select: {
                    notificationsOptIn: true,
                  },
                },
              },
            });

            if (taskWithRelations) {
              await dispatchTaskNotification(
                taskWithRelations,
                taskEventId,
                taskEventStatus,
              );
            }
          } catch (error) {
            Sentry.captureException(error, {
              extra: {
                taskId,
                eventId: taskEventId,
                notificationType: "task-notification",
              },
            });
          }
        })(),
      );
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

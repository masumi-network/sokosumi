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

import { paymentClient } from "@/clients/masumi-payment.client";
import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import {
  requireTaskCollaboration,
  requireTaskCommentAccess,
} from "@/helpers/access-control";
import {
  calculateCentsFromMasumiAmountStrings,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import {
  conflict,
  errorResponseWithExtensionsSchema,
  unprocessableEntity,
} from "@/helpers/error";
import { createNotification } from "@/helpers/notifications";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, unprocessableWithData } from "@/helpers/response";
import {
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
      orchestratorId: null,
    };
  }

  if (isOrchestratorAuthContext(authContext)) {
    // Attribute status events to the orchestrator only. Context userId is
    // workspace context, not a second actor FK — keep a single FK so nested
    // `actor` and deprecated flat summaries stay unambiguous.
    return {
      userId: null,
      coworkerId: null,
      orchestratorId: authContext.orchestratorId,
    };
  }

  // Status transitions from a delegated coworker are attributed to the acting
  // coworker only. Context userId is workspace context, not a second actor FK.
  return {
    userId: null,
    coworkerId: authContext.coworkerId,
    orchestratorId: null,
  };
}

function getCommentEventActorData(authContext: AuthenticationContext) {
  if (isUserAuthContext(authContext)) {
    return {
      userId: authContext.userId,
      coworkerId: null,
      orchestratorId: null,
    };
  }

  if (isOrchestratorAuthContext(authContext)) {
    return {
      userId: null,
      coworkerId: null,
      orchestratorId: authContext.orchestratorId,
    };
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
        cents: undefined,
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
        cents: undefined,
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

    const { event, userId, masumiPayment, pausedForInsufficientBalance } =
      await serializableTransaction(async (tx) => {
        const { status, credits, authenticationUrl, channel, masumiPayment } =
          body;
        let comment = body.comment;

        const hasNonCommentWrite =
          status !== undefined ||
          credits != null ||
          authenticationUrl != null ||
          masumiPayment != null;

        const task = hasNonCommentWrite
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
            ? getStatusEventActorData(authContext)
            : credits != null || masumiPayment != null
              ? getCoworkerActorData(authContext)
              : getCommentEventActorData(authContext);

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

        // Update task when the caller requested a status change, or when a
        // failed charge replaced the outcome with OUT_OF_CREDITS (incl.
        // credit-only bodies that had no status).
        if (eventStatus != null) {
          const updateResult = await tx.task.updateMany({
            where: { id: taskId, status: task.status },
            data: { status: eventStatus },
          });
          if (updateResult.count !== 1) {
            throw conflict("Task status was changed by another request");
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
          pausedForInsufficientBalance,
        };
      }, "Task changed by a concurrent request. Please retry.");

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

    if (masumiPayment != null) {
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

      const masumiPurchasePromise = paymentClient()
        .createPurchaseFromMasumiTaskPayment({
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
          metadata: JSON.stringify({
            taskId,
            taskEventId,
          }),
        })
        .then((createPurchaseResult) => {
          if (createPurchaseResult.isErr()) {
            console.error(
              "[tasks] masumi task payment: purchase creation failed",
              {
                taskId,
                taskEventId,
                blockchainIdentifier: masumiPayment.blockchainIdentifier,
                error: createPurchaseResult.error,
              },
            );
            Sentry.captureMessage(
              `Task purchase creation failed: ${createPurchaseResult.error}`,
              {
                level: "error",
                tags: {
                  error_type: "task_purchase_creation_failed",
                },
                contexts: {
                  task_purchase_creation: {
                    taskId,
                    taskEventId,
                    blockchainIdentifier: masumiPayment.blockchainIdentifier,
                    error: createPurchaseResult.error,
                  },
                },
              },
            );
            return;
          }

          console.info("[tasks] masumi task payment: purchase created", {
            taskId,
            taskEventId,
            purchaseId: createPurchaseResult.value.id,
            blockchainIdentifier:
              createPurchaseResult.value.blockchainIdentifier,
          });

          Sentry.addBreadcrumb({
            category: "task_masumi_purchase",
            message: "Task purchase created",
            level: "info",
            data: {
              taskId,
              purchaseId: createPurchaseResult.value.id,
            },
          });
        })
        .catch((error: unknown) => {
          console.error("[tasks] masumi task payment: unexpected error", {
            taskId,
            taskEventId,
            blockchainIdentifier: masumiPayment.blockchainIdentifier,
            error,
          });
          Sentry.captureException(error, {
            tags: {
              error_type: "task_masumi_purchase_unexpected",
            },
            extra: { taskId, taskEventId },
          });
        });

      waitUntil(masumiPurchasePromise);
    }

    try {
      await publishTaskEventData({
        userId,
        taskId,
        eventType: "task_event",
      });
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          error_type: "publish_task_event",
        },
      });
    }

    const parsedEvent = taskEventSchema.parse(event);

    // Charge failed but OUT_OF_CREDITS pause was committed — not what the
    // requester asked to create, so 422 with the pause event in `data`.
    if (pausedForInsufficientBalance) {
      return unprocessableWithData(c, parsedEvent, {
        message: "Insufficient balance",
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
      });
    }

    return created(c, parsedEvent);
  });
}

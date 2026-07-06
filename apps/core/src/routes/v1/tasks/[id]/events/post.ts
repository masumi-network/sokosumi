import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { NotificationKind, Prisma } from "@sokosumi/database";
import {
  convertCentsToCredits,
  convertCreditsToCents,
  TaskStatus,
} from "@sokosumi/utils";

import { waitUntil } from "@vercel/functions";

import { paymentClient } from "@/clients/masumi-payment.client";
import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import {
  requireTaskCollaboration,
  resolveTaskCommentAccess,
} from "@/helpers/access-control";
import {
  calculateCentsFromMasumiAmountStrings,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import { conflict, unprocessableEntity } from "@/helpers/error";
import { createNotification } from "@/helpers/notifications";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  isTaskStatusSpendable,
  mapTaskEvent,
  taskEventApiInclude,
  validateStatusTransition,
  validateTaskCoworkerAssignment,
} from "@/helpers/task";
import { createTaskEventTransaction } from "@/helpers/task-credits";
import { publishTaskEventData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type AuthenticationContext,
  isCoworkerAgentContext,
  isCoworkerAuthContext,
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

function getActorData(authContext: AuthenticationContext) {
  if (isUserAuthContext(authContext)) {
    return {
      userId: authContext.userId,
      coworkerId: null,
    };
  }

  // A delegated coworker acts on behalf of the user: attribute the event to the
  // delegated user, but keep the coworker that actually performed it so the
  // audit trail honestly shows "coworker X on behalf of user Y" rather than a
  // user-only record. Delegation only reaches tasks assigned to this coworker
  // (see SOK-554), so the recorded coworker is the task's assigned coworker.
  if (authContext.delegation) {
    return {
      userId: authContext.delegation.userId,
      coworkerId: authContext.coworkerId,
    };
  }

  return {
    userId: null,
    coworkerId: authContext.coworkerId,
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
    userId: string;
    name: string | null;
    coworker: {
      name: string;
      slug: string | null;
      image: string | null;
    } | null;
    project: { name: string } | null;
    projectId: string | null;
    workspaceId: string | null;
    user: { notificationsOptIn: boolean };
  },
  eventId: string,
  status: string,
): Promise<void> {
  if (!task.user.notificationsOptIn) {
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
    const coworkerName = task.coworker?.name ?? "Assistant";
    const projectName = task.project?.name;

    const messageParams: Record<string, unknown> = {
      coworkerName,
      taskName,
    };

    // Avatar hints for notification UIs. Skipped for CANCELED — its message
    // ("{taskName} was canceled") names no actor, and the cancel is usually
    // the user's own; a coworker avatar there would misattribute it.
    if (status !== "CANCELED") {
      if (task.coworker?.image) {
        messageParams.coworkerImage = task.coworker.image;
      }
      if (task.coworker?.slug) {
        messageParams.coworkerSlug = task.coworker.slug;
      }
    }

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
      userId: task.userId,
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
        userId: task.userId,
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
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  });

  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: taskId } = c.req.valid("param");
    const body = c.req.valid("json");

    const { event, userId, masumiPayment } = await serializableTransaction(
      async (tx) => {
        // Comment-only events (no status transition, hence no billing — the
        // credits/masumi paths are only reachable through the status branch)
        // use the wider comment gate: workspace members may comment on
        // colleagues' tasks, and delegated coordinators like Hermes may
        // comment on unassigned tasks the delegated user owns when granted
        // TASK_COMMENT. Status changes keep the strict ownership/assignment
        // gate.
        let heldByGrantId: string | null = null;
        let task: Awaited<ReturnType<typeof requireTaskCollaboration>>;
        if (body.status === undefined) {
          // Deliberately NOT on `tx`: the hold-grant row is committed on the
          // global client, and this serializable transaction's snapshot is
          // taken at its first statement — running the gate on `tx` would
          // pin a snapshot that predates the grant commit and fail the
          // heldByGrantId FK check on the event insert.
          const access = await resolveTaskCommentAccess(c.var, taskId);
          task = access.task;
          heldByGrantId = access.heldByGrantId;
        } else {
          task = await requireTaskCollaboration(authContext, taskId, tx);
        }
        const {
          status,
          comment,
          credits,
          authenticationUrl,
          origin,
          masumiPayment,
        } = body;

        if (status !== undefined) {
          // Accepting/declining a coworker-created task is a session-user
          // decision outside the normal transition tables: INPUT_REQUIRED
          // normally only allows CANCEL_REQUESTED for users, but an
          // awaiting task has no running agent — accept goes straight to
          // READY, decline straight to CANCELED. Session-only on purpose:
          // a delegated coworker must never accept its own creation.
          const isAcceptanceDecision =
            task.awaitingAcceptance &&
            isUserAuthContext(authContext) &&
            (status === TaskStatus.READY || status === TaskStatus.CANCELED);
          // Accept/decline are the ONLY moves on an awaiting task. Anything
          // else (e.g. the generic "Cancel request" -> CANCEL_REQUESTED)
          // would strand it: no agent can see the task to ever process the
          // request. Coworker contexts never get here — their gates 404
          // awaiting tasks.
          if (task.awaitingAcceptance && !isAcceptanceDecision) {
            throw unprocessableEntity(
              "This task is waiting for your acceptance. Accept or decline it first.",
            );
          }
          if (!isAcceptanceDecision) {
            validateStatusTransition(authContext, task.status, status);
          }
          validateTaskCoworkerAssignment({
            status,
            coworkerId: task.coworkerId,
          });

          // Only the assigned coworker agent settles billing.
          const isAgent = isCoworkerAgentContext(authContext);
          const isAgentSpend = isAgent && isTaskStatusSpendable(status);

          // User and delegated-coworker callers use the user transition table,
          // and the charge branch below is gated on isAgent — so credits from
          // them would be silently dropped. Reject it.
          //
          // masumiPayment needs no check here: the schema only allows it with
          // status COMPLETED, which the user transition table can never reach,
          // so a non-agent caller is already rejected upstream (400/422).
          if (!isAgent && credits != null) {
            throw unprocessableEntity(
              "Only the assigned coworker can set credits when changing task status",
            );
          }

          let cents: bigint | undefined;
          let transactionId: string | null = null;

          if (isAgentSpend) {
            if (masumiPayment) {
              console.info("[tasks] masumi task payment: using masumiPayment", {
                masumiPayment,
              });
              const creditCosts = await getCreditCostsOrThrow(tx);
              cents = calculateCentsFromMasumiAmountStrings(
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
              transactionId = await createTaskEventTransaction({
                userId: task.userId,
                organizationId: task.organizationId,
                cents,
                tx,
              });
            } else if (credits != null && credits > 0) {
              cents = convertCreditsToCents(credits);
              if (cents === 0n) {
                throw unprocessableEntity(
                  `Credit amount rounds to zero; minimum chargeable amount is ${LIMITS.MIN_CHARGEABLE_CREDITS} credits`,
                );
              }
              transactionId = await createTaskEventTransaction({
                userId: task.userId,
                organizationId: task.organizationId,
                cents,
                tx,
              });
            }
          }

          const createdEvent = await tx.taskEvent.create({
            data: {
              taskId,
              status,
              comment,
              authenticationUrl,
              origin,
              cents,
              transactionId,
              ...getActorData(authContext),
            },
          });

          const updateResult = await tx.task.updateMany({
            where: { id: taskId, status: task.status },
            data: {
              status,
              // The owner's first status decision on a coworker-created
              // task resolves the acceptance state — accept (READY) and
              // decline (CANCELED) both clear the badge.
              ...(task.awaitingAcceptance && isUserAuthContext(authContext)
                ? { awaitingAcceptance: false }
                : {}),
            },
          });
          if (updateResult.count !== 1) {
            throw conflict("Task status was changed by another request");
          }

          const payment =
            masumiPayment !== undefined && isAgentSpend ? masumiPayment : null;

          return {
            event: await mapCreatedTaskEventForResponse(tx, createdEvent.id),
            userId: task.userId,
            masumiPayment: payment,
          };
        }

        if (comment === undefined) {
          throw unprocessableEntity(
            "Either status or comment must be provided",
          );
        }

        const createdEvent = await tx.taskEvent.create({
          data: {
            taskId,
            status: null,
            comment,
            origin,
            // Ungranted delegated comments are stored held: only the task
            // owner sees them until they approve the coworker's access
            // (releases them) or deny it (deletes them).
            heldByGrantId,
            ...getActorData(authContext),
          },
        });

        return {
          event: await mapCreatedTaskEventForResponse(tx, createdEvent.id),
          userId: task.userId,
          masumiPayment: null,
        };
      },
      "Task changed by a concurrent request. Please retry.",
    );

    // Every held comment notifies the task owner — the COWORKER_ACCESS
    // request notification fires only once per grant, so without this,
    // follow-up held comments would arrive silently.
    if (!event.status && event.held) {
      const heldEventId = event.id;
      const commenterCoworkerId = isCoworkerAuthContext(authContext)
        ? authContext.coworkerId
        : null;

      waitUntil(
        (async () => {
          try {
            const [task, commenter] = await Promise.all([
              prisma.task.findUnique({
                where: { id: taskId },
                select: {
                  name: true,
                  userId: true,
                  workspaceId: true,
                  user: { select: { notificationsOptIn: true } },
                },
              }),
              commenterCoworkerId
                ? prisma.coworker.findUnique({
                    where: { id: commenterCoworkerId },
                    select: { name: true, slug: true, image: true },
                  })
                : null,
            ]);
            if (!task?.user.notificationsOptIn) return;
            await createNotification({
              userId: task.userId,
              kind: NotificationKind.TASK,
              referenceId: taskId,
              eventId: heldEventId,
              messageKey: "Notifications.Task.heldComment",
              messageParams: {
                coworkerName: commenter?.name ?? "A coworker",
                taskName: task.name ?? "Untitled task",
                ...(commenter?.image ? { coworkerImage: commenter.image } : {}),
                ...(commenter?.slug ? { coworkerSlug: commenter.slug } : {}),
              },
              metadata: {
                ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}),
              },
            });
          } catch (error) {
            Sentry.captureException(error, {
              extra: {
                taskId,
                eventId: heldEventId,
                notificationType: "held-comment-notification",
              },
            });
          }
        })(),
      );
    }

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
                userId: true,
                name: true,
                projectId: true,
                workspaceId: true,
                coworker: {
                  select: {
                    name: true,
                    slug: true,
                    image: true,
                  },
                },
                project: {
                  select: {
                    name: true,
                  },
                },
                user: {
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

    return created(c, taskEventSchema.parse(event));
  });
}

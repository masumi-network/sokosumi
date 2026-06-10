import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { Prisma } from "@sokosumi/database";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";

import { paymentClient } from "@/clients/masumi-payment.client";
import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { requireTaskCollaboration } from "@/helpers/access-control";
import {
  calculateCentsFromMasumiAmountStrings,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import { conflict, unprocessableEntity } from "@/helpers/error";
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
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type AuthenticationContext,
  isCoworkerAgentContext,
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

  // A delegated coworker acts as the user, so the event is attributed to that user.
  if (authContext.delegation) {
    return {
      userId: authContext.delegation.userId,
      coworkerId: null,
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

    const { event, userId, masumiPayment } = await prisma.$transaction(
      async (tx) => {
        const task = await requireTaskCollaboration(authContext, taskId, tx);
        const {
          status,
          comment,
          credits,
          authenticationUrl,
          origin,
          masumiPayment,
        } = body;

        if (status !== undefined) {
          validateStatusTransition(authContext, task.status, status);
          validateTaskCoworkerAssignment({
            status,
            coworkerId: task.coworkerId,
          });

          // Billing is settled only by the assigned coworker agent. User and
          // delegated-coworker callers use the user transition table, and the
          // charge branch below is gated on isCoworkerAgentContext — so credits
          // from them would be silently dropped. Reject it.
          //
          // masumiPayment needs no check here: the schema only allows it with
          // status COMPLETED, which the user transition table can never reach,
          // so a non-agent caller is already rejected upstream (400/422).
          if (!isCoworkerAgentContext(authContext) && credits != null) {
            throw unprocessableEntity(
              "Only the assigned coworker can set credits when changing task status",
            );
          }

          let cents: bigint | undefined;
          let transactionId: string | null = null;

          if (
            isCoworkerAgentContext(authContext) &&
            isTaskStatusSpendable(status)
          ) {
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
            data: { status },
          });
          if (updateResult.count !== 1) {
            throw conflict("Task status was changed by another request");
          }

          const payment =
            masumiPayment !== undefined &&
            isCoworkerAgentContext(authContext) &&
            isTaskStatusSpendable(status)
              ? masumiPayment
              : null;

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
            ...getActorData(authContext),
          },
        });

        return {
          event: await mapCreatedTaskEventForResponse(tx, createdEvent.id),
          userId: task.userId,
          masumiPayment: null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

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

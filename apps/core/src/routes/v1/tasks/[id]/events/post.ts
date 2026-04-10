import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { Prisma } from "@sokosumi/database";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";
import { v4 as uuidv4 } from "uuid";

import { paymentClient } from "@/clients/masumi-payment.client";
import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { requireTaskAccess } from "@/helpers/access-control";
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
  validateStatusTransition,
  validateTaskCoworkerAssignment,
} from "@/helpers/task";
import { createTaskEventTransaction } from "@/helpers/task-credits";
import { publishTaskEventData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
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
  if (isCoworkerAuthContext(authContext)) {
    return {
      userId: null,
      coworkerId: authContext.coworkerId,
    };
  } else {
    return {
      userId: authContext.userId,
      coworkerId: null,
    };
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

    const { event, userId, masumiAsyncPurchase } = await prisma.$transaction(
      async (tx) => {
        const task = await requireTaskAccess(authContext, taskId, tx);
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

          let cents: bigint | undefined;
          let transactionId: string | null = null;

          if (
            isCoworkerAuthContext(authContext) &&
            isTaskStatusSpendable(status)
          ) {
            if (masumiPayment) {
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

          const masumiAsync =
            masumiPayment !== undefined &&
            isCoworkerAuthContext(authContext) &&
            isTaskStatusSpendable(status)
              ? { taskEventId: createdEvent.id, payment: masumiPayment }
              : null;

          return {
            event: mapTaskEvent(createdEvent),
            userId: task.userId,
            masumiAsyncPurchase: masumiAsync,
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
          event: mapTaskEvent(createdEvent),
          userId: task.userId,
          masumiAsyncPurchase: null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    if (masumiAsyncPurchase !== null) {
      const mp = masumiAsyncPurchase.payment;
      const taskEventId = masumiAsyncPurchase.taskEventId;
      const identifierFromPurchaser = uuidv4()
        .replace(/-/g, "")
        .substring(0, 20);

      Sentry.addBreadcrumb({
        category: "task_masumi_purchase",
        message: "Scheduling task purchase (async)",
        level: "info",
        data: {
          taskId,
          taskEventId,
          blockchainIdentifier: mp.blockchainIdentifier,
        },
      });

      void paymentClient()
        .createPurchaseFromMasumiTaskPayment({
          blockchainIdentifier: mp.blockchainIdentifier,
          agentIdentifier: mp.agentIdentifier,
          sellerVkey: mp.sellerVkey,
          submitResultTime: mp.submitResultTime,
          payByTime: mp.payByTime,
          unlockTime: mp.unlockTime,
          externalDisputeUnlockTime: mp.externalDisputeUnlockTime,
          inputHash: mp.inputHash,
          Amounts: mp.Amounts,
          identifierFromPurchaser,
          metadata: JSON.stringify({
            taskId,
            taskEventId,
          }),
        })
        .then((createPurchaseResult) => {
          if (createPurchaseResult.isErr()) {
            Sentry.setTag("error_type", "task_purchase_creation_failed");
            Sentry.setContext("task_purchase_creation", {
              taskId,
              taskEventId,
              blockchainIdentifier: mp.blockchainIdentifier,
              error: createPurchaseResult.error,
            });
            Sentry.captureMessage(
              `Task purchase creation failed: ${createPurchaseResult.error}`,
              "error",
            );
            return;
          }

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
          Sentry.captureException(error, {
            tags: {
              error_type: "task_masumi_purchase_unexpected",
            },
            extra: { taskId, taskEventId },
          });
        });
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

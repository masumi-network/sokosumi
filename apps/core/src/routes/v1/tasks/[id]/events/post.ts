import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { Prisma } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/database/helpers";

import { requireTaskAccess } from "@/helpers/access-control";
import { conflict, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  isChargeableTaskStatus,
  mapTaskEvent,
  validateStatusTransition,
  validateTaskCoworkerAssignment,
} from "@/helpers/task";
import { createTaskEventTransaction } from "@/helpers/task-credits";
import { publishTaskEventData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { taskEventSchema } from "@/schemas/task.schema";

import { isCreditableTaskStatus } from "./helper";
import { createTaskEventRequestSchema } from "./schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
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
          schema: createTaskEventRequestSchema,
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
  },
});

function getActorData(authContext: AuthenticationContext) {
  if (authContext.coworkerId) {
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
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: taskId } = c.req.valid("param");
    const body = c.req.valid("json");

    const { event, userId } = await prisma.$transaction(
      async (tx) => {
        const task = await requireTaskAccess(authContext, taskId, tx);
        const { status, comment, credits, authenticationUrl, origin } = body;

        if (status !== undefined) {
          validateStatusTransition(authContext, task.status, status);
          validateTaskCoworkerAssignment({
            status,
            coworkerId: task.coworkerId,
          });

          let transactionId: string | null = null;
          let cents: bigint | undefined = undefined;
          if (isCreditableTaskStatus(status) && credits != null) {
            cents = convertCreditsToCents(credits);
          }
          if (
            isChargeableTaskStatus(status) &&
            cents !== undefined &&
            cents > 0n
          ) {
            transactionId = await createTaskEventTransaction({
              userId: task.userId,
              organizationId: task.organizationId,
              cents,
              tx,
            });
          }

          const event = await tx.taskEvent.create({
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
          // Verify that exactly one row was updated to prevent race conditions
          // If another transaction already completed the task, this will be 0
          if (updateResult.count !== 1) {
            throw conflict("Task status was changed by another request");
          }

          return { event: mapTaskEvent(event), userId: task.userId };
        }

        if (comment === undefined) {
          throw unprocessableEntity(
            "Either status or comment must be provided",
          );
        }

        const event = await tx.taskEvent.create({
          data: {
            taskId,
            status: null,
            comment,
            origin,
            ...getActorData(authContext),
          },
        });

        return { event: mapTaskEvent(event), userId: task.userId };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

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

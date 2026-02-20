import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { Prisma, TaskStatus } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/database/helpers";

import { requireTaskAccess } from "@/helpers/access-control";
import { conflict, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  isTaskStatusSpendable,
  mapTaskEvent,
  validateStatusTransition,
  validateTaskCoworkerAssignment,
} from "@/helpers/task";
import { createTaskEventTransactionCappedByBalance } from "@/helpers/task-credits";
import { publishTaskEventData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { taskEventSchema } from "@/schemas/task.schema";

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

interface ResolveCoworkerStatusEventInput {
  credits: number | null | undefined;
  userId: string;
  organizationId: string | null;
  status: TaskStatus;
  tx: Prisma.TransactionClient;
}

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

async function resolveCoworkerStatusEvent({
  credits,
  userId,
  organizationId,
  status,
  tx,
}: ResolveCoworkerStatusEventInput): Promise<{
  cents: bigint | undefined;
  effectiveStatus: TaskStatus;
  transactionId: string | null;
}> {
  let effectiveStatus = status;
  let transactionId: string | null = null;
  let cents: bigint | undefined;

  if (isTaskStatusSpendable(status) && credits != null && credits > 0) {
    cents = convertCreditsToCents(credits);
    const cappedResult = await createTaskEventTransactionCappedByBalance({
      userId,
      organizationId,
      requestedCents: cents,
      tx,
    });
    transactionId = cappedResult.transactionId;

    if (cappedResult.consumedCents < cents) {
      effectiveStatus = TaskStatus.OUT_OF_CREDITS;
    }
  }

  return {
    cents,
    effectiveStatus,
    transactionId,
  };
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

          let effectiveStatus = status;
          let cents: bigint | undefined;
          let transactionId: string | null = null;

          if (authContext.coworkerId) {
            const resolvedEvent = await resolveCoworkerStatusEvent({
              credits,
              userId: task.userId,
              organizationId: task.organizationId,
              status,
              tx,
            });
            effectiveStatus = resolvedEvent.effectiveStatus;
            cents = resolvedEvent.cents;
            transactionId = resolvedEvent.transactionId;
          }

          const event = await tx.taskEvent.create({
            data: {
              taskId,
              status: effectiveStatus,
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
            data: { status: effectiveStatus },
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

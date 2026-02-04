import { createRoute, z } from "@hono/zod-openapi";
import { Prisma, TaskStatus } from "@sokosumi/database";

import { requireTaskAccess } from "@/helpers/access-control";
import { conflict, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { validateStatusTransition } from "@/helpers/task";
import { createTaskCompletionTransaction } from "@/helpers/task-credits";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
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

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const event = await prisma.$transaction(
      async (tx) => {
        const task = await requireTaskAccess(authContext, id, tx);
        const { status, comment, credits, authenticationUrl } = body;

        const isStatusEvent = status !== undefined;
        const isCommentOnlyEvent = !isStatusEvent && comment !== undefined;

        // Handle status event (status can include optional comment)
        if (isStatusEvent) {
          validateStatusTransition(authContext, task.status, status);

          let transactionId: string | null = null;
          if (status === TaskStatus.COMPLETED) {
            if (task.transactionId) {
              throw conflict("Task already charged");
            }
            if (credits === undefined) {
              throw unprocessableEntity(
                "Credits are required when completing a task",
              );
            }
            transactionId = await createTaskCompletionTransaction({
              userId: task.userId,
              organizationId: task.organizationId,
              credits,
              tx,
            });
          }

          // Create the status event (with optional comment)
          const event = await tx.taskEvent.create({
            data: {
              taskId: id,
              status,
              comment,
              authenticationUrl: authenticationUrl ?? null,
              userId: authContext.orchestratorId ? null : authContext.userId,
              orchestratorId: authContext.orchestratorId ?? null,
            },
          });

          const updateResult = await tx.task.updateMany({
            where: { id, status: task.status },
            data: {
              status,
              ...(transactionId && {
                transactionId,
              }),
            },
          });
          // Verify that exactly one row was updated to prevent race conditions
          // If another transaction already completed the task, this will be 0
          if (updateResult.count !== 1) {
            throw conflict("Task status was changed by another request");
          }

          return event;
        }

        // Handle comment-only event (no status change)
        if (isCommentOnlyEvent) {
          const event = await tx.taskEvent.create({
            data: {
              taskId: id,
              status: null,
              comment,
              userId: authContext.orchestratorId ? null : authContext.userId,
              orchestratorId: authContext.orchestratorId ?? null,
            },
          });

          return event;
        }

        throw unprocessableEntity("Either status or comment must be provided");
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return created(c, taskEventSchema.parse(event));
  });
}

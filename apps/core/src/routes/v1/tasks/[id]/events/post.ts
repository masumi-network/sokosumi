import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { requireTaskAccess } from "@/helpers/access-control";
import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { validateStatusTransition } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskEventSchema } from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

export const createTaskEventRequestSchema = z
  .object({
    status: z
      .enum(TaskStatus)
      .optional()
      .openapi({ example: TaskStatus.RUNNING }),
    comment: z
      .string()
      .optional()
      .openapi({ example: "Task Event is running" }),
  })
  .refine((data) => data.status !== undefined || data.comment !== undefined, {
    message: "At least one of status or comment is required",
    path: ["status", "comment"],
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
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const event = await prisma.$transaction(async (tx) => {
      const task = await requireTaskAccess(authContext, id, tx);
      const { status, comment } = body;

      const isStatusEvent = status !== undefined;
      const isCommentOnlyEvent = !isStatusEvent && comment !== undefined;

      // Handle status event (status can include optional comment)
      if (isStatusEvent) {
        validateStatusTransition(authContext, task.status, status);

        // Create the status event (with optional comment)
        const event = await tx.taskEvent.create({
          data: {
            taskId: id,
            status,
            comment,
            userId: authContext.orchestratorId ? null : authContext.userId,
            orchestratorId: authContext.orchestratorId ?? null,
          },
        });

        await tx.task.update({
          where: { id, status: task.status },
          data: {
            status,
          },
        });

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
    });

    return created(c, taskEventSchema.parse(event));
  });
}

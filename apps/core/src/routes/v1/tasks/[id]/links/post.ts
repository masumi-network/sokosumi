import { createRoute, z } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";

import { requireUserTaskAccess } from "@/helpers/access-control";
import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  isPrismaTransactionConflict,
  isPrismaUniqueViolation,
} from "@/helpers/prisma";
import { created } from "@/helpers/response";
import {
  assertTaskLinkAllowed,
  mapTaskLinkForTask,
} from "@/helpers/task-link";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  createTaskLinkRequestSchema,
  taskLinkSchema,
} from "@/schemas/task-link.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/links",
  description: "Create a directed link from this task to another task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: createTaskLinkRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(taskLinkSchema, "Task link created"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const { toTaskId, type, note } = body;

    const link = await (async () => {
      try {
        return await prisma.$transaction(
          async (tx) => {
            await requireUserTaskAccess(authContext, id, tx);
            await requireUserTaskAccess(authContext, toTaskId, tx);
            assertTaskLinkAllowed(id, toTaskId);

            try {
              return await tx.taskLink.create({
                data: {
                  fromTaskId: id,
                  toTaskId,
                  type,
                  note: note ?? null,
                },
              });
            } catch (error) {
              if (isPrismaUniqueViolation(error)) {
                throw conflict("This task link already exists");
              }
              throw error;
            }
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error) {
        if (isPrismaTransactionConflict(error)) {
          throw conflict("Task changed while creating the link. Please retry.");
        }
        throw error;
      }
    })();

    return created(c, mapTaskLinkForTask(id, link));
  });
}

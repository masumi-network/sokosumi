import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskOwnership } from "@/helpers/access-control";
import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { created } from "@/helpers/response";
import {
  assertTaskLinkAllowed,
  mapTaskLink,
  mapTaskLinkRelationToWriteData,
} from "@/helpers/task-link";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createTaskLinkRequestSchema,
  taskLinkSchema,
} from "@/schemas/task-link.schema";
import { taskLinkPeerTaskSelect } from "@/types/task-link";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/links",
  description: "Create a link between this task and another task",
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
    const userContext = requireUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const { toTaskId: peerTaskId, relation, note } = body;

    const { link, peerTask } = await serializableTransaction(async (tx) => {
      await requireTaskOwnership(userContext, id, tx);
      assertTaskLinkAllowed(id, peerTaskId);
      const linkData = mapTaskLinkRelationToWriteData(id, peerTaskId, relation);

      const peerTask = await tx.task.findFirst({
        where: {
          id: peerTaskId,
          userId: userContext.userId,
          workspaceId: workspaceContext.workspaceId,
        },
        select: taskLinkPeerTaskSelect,
      });

      if (!peerTask) {
        throw notFound("Task not found");
      }

      try {
        const link = await tx.taskLink.create({
          data: {
            ...linkData,
            note: note ?? null,
          },
        });

        return {
          link,
          peerTask,
        };
      } catch (error) {
        if (isPrismaUniqueViolation(error)) {
          throw conflict("This task link already exists");
        }
        throw error;
      }
    }, "Task changed while creating the link. Please retry.");

    return created(c, mapTaskLink(id, link, peerTask));
  });
}

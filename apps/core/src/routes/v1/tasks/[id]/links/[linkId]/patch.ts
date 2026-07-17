import { createRoute, z } from "@hono/zod-openapi";

import { requireMutableTaskOwnership } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  mapTaskLink,
  mapTaskLinkRelationToTypeForExistingDirection,
} from "@/helpers/task-link";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  patchTaskLinkRequestSchema,
  taskLinkSchema,
} from "@/schemas/task-link.schema";
import { taskLinkPeerTaskSelect } from "@/types/task-link";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
  linkId: z.string().openapi({
    param: { name: "linkId", in: "path" },
    example: "tl_123",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/{id}/links/{linkId}",
  description: "Update a link between this task and another task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: patchTaskLinkRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(taskLinkSchema, "Task link updated"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id, linkId } = c.req.valid("param");
    const { relation, note } = c.req.valid("json");

    const { link, peerTask } = await prisma.$transaction(async (tx) => {
      const link = await tx.taskLink.findUnique({
        where: { id: linkId },
      });

      if (!link || (link.fromTaskId !== id && link.toTaskId !== id)) {
        throw notFound("Task link not found");
      }

      await requireMutableTaskOwnership(userContext, id, tx);

      const peerTaskId =
        link.fromTaskId === id ? link.toTaskId : link.fromTaskId;
      const peerTask = await tx.task.findFirst({
        where: {
          id: peerTaskId,
          ownerId: userContext.userId,
          workspaceId: workspaceContext.workspaceId,
        },
        select: taskLinkPeerTaskSelect,
      });

      if (!peerTask) {
        throw notFound("Peer task not found");
      }

      const nextType =
        relation === undefined
          ? undefined
          : mapTaskLinkRelationToTypeForExistingDirection(id, link, relation);

      const updatedLink = await tx.taskLink.update({
        where: { id: linkId },
        data: {
          ...(nextType !== undefined ? { type: nextType } : {}),
          ...(note !== undefined ? { note } : {}),
        },
      });

      return {
        link: updatedLink,
        peerTask,
      };
    });

    return ok(c, mapTaskLink(id, link, peerTask));
  });
}

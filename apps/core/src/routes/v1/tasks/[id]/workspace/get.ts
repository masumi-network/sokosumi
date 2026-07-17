import { createRoute, z } from "@hono/zod-openapi";

import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { taskWorkspaceSchema } from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/workspace",
  description: "Resolve a task id to its workspace and organization id",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskWorkspaceSchema, "Task workspace mapping", {
      data: {
        name: "Research competitor pricing",
        workspaceId: "11111111-1111-7111-8111-111111111111",
        organizationId: "org_123",
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userAuthContext = requireUserAuthContext(authContext);
    const { id } = c.req.valid("param");

    const task = await prisma.task.findUnique({
      where: {
        id,
        archivedAt: null,
      },
      select: {
        name: true,
        ownerId: true,
        workspaceId: true,
        workspace: {
          select: {
            organizationId: true,
          },
        },
      },
    });

    if (!task) {
      throw notFound("Task not found");
    }

    if (task.workspace.organizationId) {
      await resolveMemberOrganizationById({
        id: task.workspace.organizationId,
        userId: userAuthContext.userId,
        tx: prisma,
      });
    } else if (task.ownerId !== userAuthContext.userId) {
      throw forbidden("You do not have access to this task");
    }

    return ok(
      c,
      taskWorkspaceSchema.parse({
        name: task.name,
        workspaceId: task.workspaceId,
        organizationId: task.workspace.organizationId,
      }),
    );
  });
}

import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskWorkspaceMapping } from "@/helpers/access-control";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
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
  description:
    "Resolve a task id to its workspace and organization id across workspaces the caller can access. Session users need org membership or personal-workspace ownership. Coworkers need authorized context headers plus an assigned-task read.",
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
    await requireAuthorizedUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const task = await requireTaskWorkspaceMapping(c.var, id, prisma);

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

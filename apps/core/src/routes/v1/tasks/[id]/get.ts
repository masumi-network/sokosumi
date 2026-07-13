import { createRoute, z } from "@hono/zod-openapi";
import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { isCoworkerAuthContext, isUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { taskSchema } from "@/schemas/task.schema";
import { buildTaskIncludeForViewer, type TaskWithIncludes } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: "Retrieve task details",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Retrieve task"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { authContext, workspaceContext } = c.var;

    const workspaceId =
      isUserAuthContext(authContext) ||
      (isCoworkerAuthContext(authContext) && authContext.context)
        ? requireWorkspaceContext(workspaceContext).workspaceId
        : null;

    const include = buildTaskIncludeForViewer(authContext, workspaceId);
    const task = (await requireTaskReadForRouteVars(
      c.var,
      id,
      prisma,
      include,
    )) as TaskWithIncludes;

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

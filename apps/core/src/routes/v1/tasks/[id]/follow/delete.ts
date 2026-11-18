import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskFollowersResponseSchema } from "@/schemas/task.schema";
import { unfollowTask } from "@/services/task-follow.service";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}/follow",
  description:
    "Stop following the Task with your Soko Bot. Participation is unchanged. Not following is a no-op. Human session only.",
  tags: ["Tasks"],
  request: { params: paramsSchema },
  responses: {
    200: jsonSuccessResponse(taskFollowersResponseSchema, "Task followers"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { userId } = requireOwnerUserContext(c.var.authContext);

    const followers = await prisma.$transaction(async (tx) => {
      const task = await requireTaskReadForRouteVars(c.var, id, tx);
      return unfollowTask(tx, task, userId);
    });

    return ok(c, taskFollowersResponseSchema.parse({ followers }));
  });
}

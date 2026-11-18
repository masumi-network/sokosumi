import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskCommentAccess } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskFollowersResponseSchema } from "@/schemas/task.schema";
import { followTask } from "@/services/task-follow.service";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/follow",
  description:
    "Follow the Task with the authenticated viewer's personal Soko Bot: the bot reports the Task's moments to them. Does not add the viewer as a participant. Idempotent. Requires comment access and a personal Soko Bot in the Task's workspace (409 without one). Human session only.",
  tags: ["Tasks"],
  request: { params: paramsSchema },
  responses: {
    200: jsonSuccessResponse(taskFollowersResponseSchema, "Task followers"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("No personal Soko Bot"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { userId } = requireOwnerUserContext(c.var.authContext);

    const followers = await prisma.$transaction(async (tx) => {
      const task = await requireTaskCommentAccess(c.var, id, tx);
      return followTask(tx, task, userId);
    });

    return ok(c, taskFollowersResponseSchema.parse({ followers }));
  });
}

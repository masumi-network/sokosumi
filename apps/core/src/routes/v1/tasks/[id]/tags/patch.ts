import { createRoute, z } from "@hono/zod-openapi";
import { requireMutableTaskOwnership } from "@/helpers/access-control";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  correctTaskTags,
  MAX_TASK_TAGS,
  mapTaskTags,
  taskTagsSchema,
} from "@/helpers/task-tags";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskTagCorrectionsSchema } from "@/schemas/task-tag-suggestion.schema";

export const patchTaskTagsSchema = taskTagCorrectionsSchema;
const route = createRoute({
  method: "patch",
  path: "/{id}/tags",
  tags: ["Tasks"],
  description:
    "Correct task tags. Removed tags stay rejected across reclassification; adding restores them.",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: patchTaskTagsSchema } } },
  },
  responses: {
    200: jsonSuccessResponse(taskTagsSchema, "Persisted task tags"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
    422: jsonErrorResponse("Unprocessable entity"),
  },
});
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const user = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { add, remove } = c.req.valid("json");
    const result = await prisma.$transaction(async (tx) => {
      // Serialize corrections without locking through an inference request.
      await tx.$queryRaw`SELECT id FROM task WHERE id = ${id} FOR UPDATE`;
      const task = await requireMutableTaskOwnership(user, id, tx);
      if (task.workspaceId !== c.var.workspaceContext?.workspaceId)
        throw notFound("Task not found");
      const data = correctTaskTags(task, add, remove);
      if (data.manualTags.length > MAX_TASK_TAGS)
        throw unprocessableEntity("Choose at most five tags");
      return tx.task.update({ where: { id }, data });
    });
    return ok(c, taskTagsSchema.parse(mapTaskTags(result)));
  });
}

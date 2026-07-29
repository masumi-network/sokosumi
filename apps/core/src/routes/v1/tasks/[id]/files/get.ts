import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTaskFile } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskFilesSchema } from "@/schemas/task-file.schema";
import { taskFileApiInclude } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/files",
  description: "List files uploaded to a task (newest first)",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskFilesSchema, "Task files"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id: taskId } = c.req.valid("param");

    // Read-only GET: no interactive transaction (pool hold / P2028 risk).
    await requireTaskReadForRouteVars(c.var, taskId);
    const files = await prisma.taskFile.findMany({
      where: { taskId },
      include: taskFileApiInclude,
      orderBy: { createdAt: "desc" },
    });

    return ok(
      c,
      taskFilesSchema.parse(
        files.map((file) =>
          mapTaskFile({
            ...file,
            taskId,
          }),
        ),
      ),
    );
  });
}

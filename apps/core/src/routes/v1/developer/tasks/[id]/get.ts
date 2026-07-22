import { createRoute } from "@hono/zod-openapi";

import { buildDeveloperOwnedCoworkerTaskWhere } from "@/helpers/developer-owned-coworker-tasks";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  developerTaskDetailSchema,
  developerTaskIdParamSchema,
} from "@/schemas/developer.schema";
import { taskInclude } from "@/types/task";

const route = createRoute({
  method: "get",
  path: "/{id}",
  operationId: "getDeveloperOwnedCoworkerTask",
  description:
    "Full task detail with owner and organization context for tasks where an owned coworker is assignee or creator.",
  tags: ["Developer"],
  request: {
    params: developerTaskIdParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      developerTaskDetailSchema,
      "Task detail for developer-owned coworker tasks",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userAuth = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const task = await prisma.task.findFirst({
      where: {
        id,
        ...buildDeveloperOwnedCoworkerTaskWhere(userAuth.userId),
      },
      include: {
        ...taskInclude,
        owner: { select: { id: true, name: true, email: true, image: true } },
      },
    });

    if (!task) {
      throw notFound("Task not found");
    }

    return ok(
      c,
      developerTaskDetailSchema.parse({
        task: mapTask(task),
        owner: {
          id: task.owner.id,
          name: task.owner.name,
          email: task.owner.email,
        },
        organization: task.organization,
      }),
    );
  });
}

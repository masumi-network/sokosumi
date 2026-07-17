import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminTaskDetailSchema,
  adminTaskIdParamSchema,
} from "@/schemas/admin.schema";
import { taskInclude } from "@/types/task";

const route = createRoute({
  method: "get",
  path: "/{id}",
  operationId: "getAdminTask",
  description:
    "Full task detail with owner and organization context. Admin only; not scoped to the caller's workspaces.",
  tags: ["Admin"],
  request: {
    params: adminTaskIdParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminTaskDetailSchema,
      "Task detail for the admin task view",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const task = await prisma.task.findUnique({
      where: { id },
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
      adminTaskDetailSchema.parse({
        task: mapTask(task),
        user: {
          id: task.owner.id,
          name: task.owner.name,
          email: task.owner.email,
        },
        organization: task.organization,
      }),
    );
  });
}

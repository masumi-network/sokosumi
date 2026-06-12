import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminTaskIdParamSchema,
  adminTaskListItemSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/{id}",
  operationId: "getAdminTask",
  description:
    "Single task with owner and organization context for the admin task detail view (admin only).",
  tags: ["Admin"],
  request: {
    params: adminTaskIdParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminTaskListItemSchema,
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
        user: { select: { id: true, name: true, email: true } },
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!task) {
      throw notFound("Task not found");
    }

    return ok(
      c,
      adminTaskListItemSchema.parse({
        id: task.id,
        name: task.name,
        status: task.status,
        createdAt: task.createdAt,
        user: task.user,
        organization: task.organization,
      }),
    );
  });
}

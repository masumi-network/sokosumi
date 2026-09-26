import { createRoute, z } from "@hono/zod-openapi";

import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireTaskNotParked } from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { mapProjectForApi, projectSchema } from "@/schemas/project.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
  taskId: z.string().openapi({
    param: { name: "taskId", in: "path" },
    example: "tsk_abc",
  }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{id}/tasks/{taskId}",
    description:
      "Remove a task from a project without deleting the task. Parked tasks cannot be unlinked. Interactive session user only; coworker keys are rejected.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(projectSchema, "Project"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, taskId } = c.req.valid("param");

    const workspaceId = workspaceContext.workspaceId;

    const project = await prisma.project.findFirst({
      where: { id: projectId, workspaceId },
    });
    if (!project) {
      throw notFound("Project or task link not found");
    }

    const task = await prisma.task.findFirst({
      where: { id: taskId, projectId, workspaceId },
      select: {
        pendingVendorGrantId: true,
        status: true,
        workspaceId: true,
      },
    });
    if (!task) {
      throw notFound("Project or task link not found");
    }

    requireTaskNotParked(task);

    await prisma.$transaction(async (tx) => {
      if (
        !(await lockCalendarScope(
          tx,
          workspaceId,
          [projectId],
          userContext.userId,
        ))
      ) {
        throw notFound("Project or task link not found");
      }
      if (!(await lockTaskRows(tx, [taskId]))) {
        throw notFound("Project or task link not found");
      }
      const unlinkResult = await tx.task.updateMany({
        where: { id: taskId, projectId, workspaceId, archivedAt: null },
        data: { projectId: null },
      });
      if (unlinkResult.count === 0) {
        throw notFound("Project or task link not found");
      }
    });
    await deliverCalendarInvalidationsNow(workspaceId);

    return ok(c, mapProjectForApi(project));
  });
}

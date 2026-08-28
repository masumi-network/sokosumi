import { createRoute, z } from "@hono/zod-openapi";

import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { refreshTaskSchedulePlannedOccurrences } from "@/helpers/task-schedule-occurrence-index";
import { requireTaskNotParked } from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrchestratorContextHeaderParameters,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  addProjectTaskRequestSchema,
  mapProjectForApi,
  projectSchema,
} from "@/schemas/project.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

const route = withOrchestratorContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/tasks",
    description:
      "Add an existing task to a project. Parked tasks awaiting vendor create approval cannot be linked. Session user or orchestrator with context headers; coworker keys are rejected.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: addProjectTaskRequestSchema,
          },
        },
      },
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
    requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const body = c.req.valid("json");

    const workspaceId = workspaceContext.workspaceId;

    const project = await prisma.project.findFirst({
      where: { id: projectId, workspaceId },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    const task = await prisma.task.findFirst({
      where: { id: body.taskId, archivedAt: null, workspaceId },
      select: {
        projectId: true,
        pendingVendorGrantId: true,
        status: true,
        metadata: true,
        nextRunAt: true,
        workspaceId: true,
      },
    });
    if (!task) {
      throw notFound("Task not found");
    }

    requireTaskNotParked(task);

    if (task.projectId !== null && task.projectId !== projectId) {
      throw conflict("Task is already assigned to a project");
    }

    if (task.projectId !== projectId) {
      await prisma.$transaction(async (tx) => {
        if (!(await lockCalendarScope(tx, workspaceId, [projectId]))) {
          throw notFound("Project not found");
        }
        if (!(await lockTaskRows(tx, [body.taskId]))) {
          throw notFound("Task not found");
        }
        const projectAssignment = await tx.task.updateMany({
          where: {
            id: body.taskId,
            archivedAt: null,
            workspaceId,
            projectId: null,
          },
          data: {
            projectId,
            workspaceId,
          },
        });
        if (projectAssignment.count === 0) {
          throw conflict("Task changed during project assignment");
        }
        const updatedTask = await tx.task.findUnique({
          where: { id: body.taskId },
          select: {
            id: true,
            workspaceId: true,
            projectId: true,
            status: true,
            metadata: true,
            nextRunAt: true,
          },
        });
        if (!updatedTask) {
          throw notFound("Task not found");
        }
        await refreshTaskSchedulePlannedOccurrences(tx, updatedTask);
      });
    }

    return ok(c, mapProjectForApi(project));
  });
}

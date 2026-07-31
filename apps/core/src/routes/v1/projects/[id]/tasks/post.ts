import { createRoute, z } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
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
      select: { projectId: true, pendingVendorGrantId: true, status: true },
    });
    if (!task) {
      throw notFound("Task not found");
    }

    requireTaskNotParked(task);

    if (task.projectId !== null && task.projectId !== projectId) {
      throw conflict("Task is already assigned to a project");
    }

    if (task.projectId !== projectId) {
      await prisma.task.update({
        where: { id: body.taskId },
        data: {
          projectId,
          workspaceId,
        },
      });
    }

    return ok(c, projectSchema.parse(project));
  });
}

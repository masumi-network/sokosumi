import { createRoute, z } from "@hono/zod-openapi";

import { requireMutableTaskOwnership } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectSchema } from "@/schemas/project.schema";

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

const route = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/tasks/{taskId}",
    description: "Remove a task from a project without deleting the task",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(projectSchema, "Project"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, taskId } = c.req.valid("param");

    const workspaceId = workspaceContext.workspaceId;

    const project = await prisma.project.findFirst({
      where: { id: projectId, workspaceId },
    });
    if (!project) {
      throw notFound("Project or task link not found");
    }

    const unlinkResult = await prisma.$transaction(async (tx) => {
      await requireMutableTaskOwnership(userContext, taskId, tx);

      return tx.task.updateMany({
        where: { id: taskId, projectId, workspaceId },
        data: { projectId: null },
      });
    });

    if (unlinkResult.count === 0) {
      throw notFound("Project or task link not found");
    }

    return ok(c, projectSchema.parse(project));
  });
}

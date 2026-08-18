import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrchestratorContextHeaderParameters,
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
});

const route = withOrchestratorContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/design-md",
    description: "Clear a project's DESIGN.md assignment.",
    tags: ["Projects"],
    request: { params: paramsSchema },
    responses: {
      200: jsonSuccessResponse(projectSchema, "Project DESIGN.md cleared"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");

    const result = await prisma.project.updateMany({
      where: { id, workspaceId: workspaceContext.workspaceId },
      data: { designMdUrl: null, designMdExtractionId: null },
    });
    if (result.count === 0) {
      throw notFound("Project not found");
    }

    const project = await prisma.project.findFirst({
      where: { id, workspaceId: workspaceContext.workspaceId },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    return ok(c, mapProjectForApi(project));
  });
}

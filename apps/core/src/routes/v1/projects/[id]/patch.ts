import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  findProjectByIdInWorkspace,
  updateProjectInWorkspace,
} from "@/lib/repository";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  patchProjectRequestSchema,
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

const route = createRoute({
  method: "patch",
  path: "/{id}",
  description: "Rename or update a project description",
  tags: ["Projects"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: patchProjectRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(projectSchema, "Updated project"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const updateData: { name?: string; description?: string | null } = {};
    if (body.name !== undefined) {
      updateData.name = body.name;
    }
    if (body.description !== undefined) {
      updateData.description = body.description ?? null;
    }

    const updated = await updateProjectInWorkspace(
      id,
      workspaceContext.workspaceId,
      updateData,
      prisma,
    );

    if (!updated) {
      throw notFound("Project not found");
    }

    const project = await findProjectByIdInWorkspace(
      id,
      workspaceContext.workspaceId,
      prisma,
    );
    if (!project) {
      throw notFound("Project not found");
    }

    return ok(c, projectSchema.parse(project));
  });
}

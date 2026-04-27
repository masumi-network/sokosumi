import { createRoute, z } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { addJobToProject, findProjectByIdInWorkspace } from "@/lib/repository";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  addProjectJobRequestSchema,
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

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/jobs",
    description: "Add an existing job to a project",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: addProjectJobRequestSchema,
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
    requireUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await addJobToProject(
      projectId,
      workspaceContext.workspaceId,
      body.jobId,
      prisma,
    );

    if (!result.ok) {
      if (result.reason === "project_not_found") {
        throw notFound("Project not found");
      }
      if (result.reason === "job_not_found") {
        throw notFound("Job not found");
      }
      throw conflict("Job is already assigned to a project");
    }

    const project = await findProjectByIdInWorkspace(
      projectId,
      workspaceContext.workspaceId,
      prisma,
    );
    if (!project) {
      throw notFound("Project not found");
    }

    return ok(c, projectSchema.parse(project));
  });
}

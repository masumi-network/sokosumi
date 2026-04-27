import { createRoute, z } from "@hono/zod-openapi";

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
  jobId: z.string().openapi({
    param: { name: "jobId", in: "path" },
    example: "job_abc",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/jobs/{jobId}",
    description: "Remove a job from a project without deleting the job",
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
    requireUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, jobId } = c.req.valid("param");

    const workspaceId = workspaceContext.workspaceId;

    const projectRow = await prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true },
    });
    if (!projectRow) {
      throw notFound("Project or job link not found");
    }

    const unlinkResult = await prisma.job.updateMany({
      where: { id: jobId, projectId, workspaceId },
      data: { projectId: null },
    });
    if (unlinkResult.count === 0) {
      throw notFound("Project or job link not found");
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, workspaceId },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    return ok(c, projectSchema.parse(project));
  });
}

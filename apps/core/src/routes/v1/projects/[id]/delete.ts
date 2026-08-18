import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrchestratorContextHeaderParameters,
} from "@/lib/hono";
import { deleteProjectBlobs } from "@/lib/project-files-blob";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

const deleteResponseSchema = z
  .object({
    id: z.string().uuid(),
    deleted: z.literal(true),
  })
  .openapi("ProjectDeleted");

const route = withOrchestratorContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}",
    description:
      "Delete a project. Session user or orchestrator with context headers; coworker keys are rejected so X-Context-User-Id cannot destroy projects in another user's workspace.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(deleteResponseSchema, "Project deleted"),
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

    const deleteResult = await prisma.project.deleteMany({
      where: { id, workspaceId: workspaceContext.workspaceId },
    });

    if (deleteResult.count === 0) {
      throw notFound("Project not found");
    }

    await deleteProjectBlobs(id);

    return ok(c, deleteResponseSchema.parse({ id, deleted: true }));
  });
}

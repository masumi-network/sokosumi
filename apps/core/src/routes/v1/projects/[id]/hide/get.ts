import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectHideSchema } from "@/schemas/project.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/hide",
    description:
      "Whether the current user has Hidden this project (ADR 0036). Separate from GET /projects/{id}, which stays free of the reader's own Pin and Hide.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(projectHideSchema, "The reader's Hide"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");

    const project = await prisma.project.findFirst({
      where: { id, workspaceId: workspaceContext.workspaceId },
      select: {
        id: true,
        hides: {
          where: { userId: userContext.userId },
          select: { hiddenAt: true },
        },
      },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    return ok(
      c,
      projectHideSchema.parse({
        projectId: project.id,
        hiddenAt: project.hides[0]?.hiddenAt ?? null,
      }),
    );
  });
}

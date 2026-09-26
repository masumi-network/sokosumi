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
import { projectStarSchema } from "@/schemas/project.schema";

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
    method: "post",
    path: "/{id}/star",
    description:
      "Pin a project for the current user (ADR 0036). A Pin is personal and never shared with the workspace. Idempotent: starring an already-Pinned project keeps the original starredAt.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(projectStarSchema, "Project starred"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // A Pin belongs to a person, so a coworker acting for a user may not set
    // one — unlike the reads on this router, which accept a bound context.
    const userContext = requireUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");

    // Scoped to the active workspace, so a project id from another workspace
    // reads as absent rather than as forbidden.
    const project = await prisma.project.findFirst({
      where: { id, workspaceId: workspaceContext.workspaceId },
      select: { id: true },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    // `update: {}` is what makes this idempotent. Rewriting starredAt on a
    // second star would move the project to the end of the reader's Pins,
    // so a double click would silently reorder their flyout.
    const star = await prisma.projectStar.upsert({
      where: {
        userId_projectId: {
          userId: userContext.userId,
          projectId: project.id,
        },
      },
      create: { userId: userContext.userId, projectId: project.id },
      update: {},
      select: { starredAt: true },
    });

    return ok(
      c,
      projectStarSchema.parse({
        projectId: project.id,
        starredAt: star.starredAt,
      }),
    );
  });
}

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
import { projectHideResultSchema } from "@/schemas/project.schema";

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
    path: "/{id}/hide",
    description:
      "Hide a project for the current user (ADR 0036). A Hide is personal and never shared, and it is the opposite of a Pin: hiding a Pinned project unpins it. A Hidden project leaves the open project list, the project switcher and recent activity; requests waiting on the user still reach them. Idempotent: hiding an already-Hidden project keeps the original hiddenAt.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(projectHideResultSchema, "Project hidden"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // A Hide belongs to a person, like a Pin, so a coworker may not set one.
    const userContext = requireUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");

    const project = await prisma.project.findFirst({
      where: { id, workspaceId: workspaceContext.workspaceId },
      select: { id: true },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    const key = { userId: userContext.userId, projectId: project.id };
    // One transaction, so a reader never ends up both Pinning and Hiding the
    // same project.
    const [unstarred, hide] = await prisma.$transaction([
      prisma.projectStar.deleteMany({ where: key }),
      prisma.projectHide.upsert({
        where: { userId_projectId: key },
        create: key,
        update: {},
        select: { hiddenAt: true },
      }),
    ]);

    return ok(
      c,
      projectHideResultSchema.parse({
        projectId: project.id,
        hiddenAt: hide.hiddenAt,
        unpinned: unstarred.count > 0,
      }),
    );
  });
}

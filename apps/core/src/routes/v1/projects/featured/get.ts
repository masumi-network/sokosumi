import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { canFeatureProjects } from "@/helpers/project-featured";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  featuredProjectSchema,
  mapProjectForApi,
} from "@/schemas/project.schema";
import { cmoProjectIds } from "@/services/cmo-cuso.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/featured",
    description:
      "The Project an owner or admin featured for every member of the active organization workspace, and whether the reader may change it. Separate from the project list so its activity order and the reader's Pins stay as they are. No project when nothing is featured, the Project is closing or closed, or the reader Hid it; never one in a personal workspace.",
    tags: ["Projects"],
    responses: {
      200: jsonSuccessResponse(featuredProjectSchema, "The featured Project"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { workspaceId, organizationId } = requireWorkspaceContext(
      c.var.workspaceContext,
    );
    if (!organizationId) {
      return ok(c, featuredProjectSchema.parse({ canFeature: false }));
    }

    const [workspace, canFeature] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { featuredProject: true },
      }),
      canFeatureProjects(userContext.userId, organizationId),
    ]);
    const featured = workspace?.featuredProject;
    // A Hide is the reader's own "not for me" (ADR 0036), so it wins here too.
    const hidden =
      featured &&
      (await prisma.projectHide.findUnique({
        where: {
          userId_projectId: {
            userId: userContext.userId,
            projectId: featured.id,
          },
        },
        select: { id: true },
      }));
    const visible =
      featured && !featured.closedAt && !featured.closingAt && !hidden
        ? featured
        : null;
    const cmoIds = visible ? await cmoProjectIds([visible.id]) : new Set();

    return ok(
      c,
      featuredProjectSchema.parse({
        project: visible
          ? mapProjectForApi(visible, { cmo: cmoIds.has(visible.id) })
          : undefined,
        canFeature,
      }),
    );
  });
}

import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { mapProjectForApi, projectSchema } from "@/schemas/project.schema";

/**
 * Far above any real Pin list, and the sidebar only draws five. This bounds
 * the payload without imposing a limit on how much a reader may Pin.
 */
const MAX_STARRED_PROJECTS = 50;

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/starred",
    description:
      "The current user's Pinned projects in the active workspace, oldest Pin first (ADR 0036). Separate from the project list because a Pinned project is usually a quiet one, so it often falls outside the activity-ordered first page. Closed projects are left out; their Pin survives, so reopening restores it.",
    tags: ["Projects"],
    responses: {
      200: jsonSuccessResponse(
        z.array(projectSchema),
        "The reader's Pinned projects",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // A Pin belongs to a person, so there is nothing to return for a
    // coworker or vendor context.
    const userContext = requireUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);

    const stars = await prisma.projectStar.findMany({
      where: {
        userId: userContext.userId,
        project: {
          workspaceId: workspaceContext.workspaceId,
          closedAt: null,
        },
      },
      // Ascending, so the reader's oldest Pin leads. Unlike a Pinned room
      // there is no reorder mode yet, so this really is the time of pinning.
      orderBy: { starredAt: "asc" },
      take: MAX_STARRED_PROJECTS,
      select: { project: true },
    });

    return ok(
      c,
      z
        .array(projectSchema)
        .parse(stars.map((star) => mapProjectForApi(star.project))),
    );
  });
}

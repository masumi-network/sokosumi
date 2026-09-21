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
import {
  mapProjectForApi,
  starredProjectSchema,
} from "@/schemas/project.schema";

/**
 * Far above any real Pin list, and the sidebar only draws five. This bounds
 * the payload without imposing a limit on how much a reader may Pin.
 *
 * Deliberately uncursored: the order is oldest Pin first, so the five the
 * flyout wants come from the near end and truncation can only hide a reader's
 * newest Pins past 50. Give this a cursor if an "all Pins" view is ever built,
 * because that view would lose them silently.
 */
const MAX_STARRED_PROJECTS = 50;

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/starred",
    description:
      "The current user's Pinned projects in the active workspace, oldest Pin first (ADR 0036). Separate from the project list because a Pinned project is usually a quiet one, so it often falls outside the activity-ordered first page. Closed projects stay in this list so a project page can still offer Unpin; the sidebar flyout drops them. The Pin row survives either way, so reopening restores it.",
    tags: ["Projects"],
    responses: {
      200: jsonSuccessResponse(
        z.array(starredProjectSchema),
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
        },
      },
      // Ascending, so the reader's oldest Pin leads. Unlike a Pinned room
      // there is no reorder mode yet, so this really is the time of pinning.
      orderBy: { starredAt: "asc" },
      take: MAX_STARRED_PROJECTS,
      select: { project: true, starredAt: true },
    });

    return ok(
      c,
      z.array(starredProjectSchema).parse(
        stars.map((star) => ({
          ...mapProjectForApi(star.project),
          starredAt: star.starredAt,
        })),
      ),
    );
  });
}

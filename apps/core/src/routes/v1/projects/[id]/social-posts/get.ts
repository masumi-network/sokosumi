import { createRoute, z } from "@hono/zod-openapi";

import { requireCalendarBetaAccess } from "@/helpers/calendar-beta-access";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  listSocialPostsQuerySchema,
  socialPostProjectParamsSchema,
  socialPostSchema,
} from "@/schemas/social-post.schema";
import { listSocialPosts } from "@/services/social-posts.service";

import { mapSocialPostServiceError } from "./route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/social-posts",
    description:
      "List a Project's Social posts. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: socialPostProjectParamsSchema,
      query: listSocialPostsQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(socialPostSchema),
        "Social posts",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    await requireCalendarBetaAccess(userContext.userId, prisma);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const { status: statuses, cursor, limit } = c.req.valid("query");

    try {
      const { posts, pagination } = await listSocialPosts({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        statuses,
        cursor,
        limit,
      });
      return ok(c, z.array(socialPostSchema).parse(posts), pagination);
    } catch (error) {
      return mapSocialPostServiceError(error);
    }
  });
}

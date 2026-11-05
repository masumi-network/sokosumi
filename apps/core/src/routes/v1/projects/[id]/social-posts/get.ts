import { createRoute, z } from "@hono/zod-openapi";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  listSocialPostsQuerySchema,
  socialPostProjectParamsSchema,
  socialPostSchema,
} from "@/schemas/social-post.schema";
import { listSocialPosts } from "@/services/social-posts.service";

import {
  mapSocialPostServiceError,
  presentSocialPost,
} from "./route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-posts",
    description:
      "List a Project's Social posts. Requires an interactive session or an authorized task-capable Coworker with user context in the Project's Workspace. Publish now remains human-only.",
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
    const userContext = await requireSocialPostActor(c.var.authContext);

    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const {
      status: statuses,
      cursor,
      limit,
      provider,
      quoteCandidates,
      excludePostId,
      search,
    } = c.req.valid("query");

    try {
      const { posts, pagination } = await listSocialPosts({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        statuses,
        provider,
        quoteCandidates,
        excludePostId,
        search,
        cursor,
        limit,
      });
      return ok(
        c,
        z
          .array(socialPostSchema)
          .parse(
            posts.map((post) =>
              presentSocialPost(post, userContext.coworkerId),
            ),
          ),
        pagination,
      );
    } catch (error) {
      return mapSocialPostServiceError(error);
    }
  });
}

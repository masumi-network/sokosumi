import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  scheduleSocialPostRequestSchema,
  socialPostParamsSchema,
  socialPostSchema,
} from "@/schemas/social-post.schema";
import { scheduleSocialPost } from "@/services/social-posts.service";

import {
  mapSocialPostServiceError,
  presentSocialPost,
} from "../../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/social-posts/{postId}/schedule",
    description:
      "Schedule a Social post through an active Project social connection. Allowed from DRAFT, NEEDS_APPROVAL, SCHEDULED, FAILED and MISSED. A post that still needs approval keeps that status. Requires an interactive session or an authorized task-capable Coworker with user context in the Project's Workspace. Publish now remains human-only.",
    tags: ["Projects"],
    request: {
      params: socialPostParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: scheduleSocialPostRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(socialPostSchema, "Social post scheduled"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = await requireSocialPostActor(c.var.authContext);

    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, postId } = c.req.valid("param");
    const input = c.req.valid("json");

    try {
      const post = await scheduleSocialPost({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        coworkerId: userContext.coworkerId,
        postId,
        scheduledAt: new Date(input.scheduledAt),
        timezone: input.timezone,
        socialConnectionId: input.socialConnectionId,
        revision: input.revision,
      });
      return ok(
        c,
        socialPostSchema.parse(presentSocialPost(post, userContext.coworkerId)),
      );
    } catch (error) {
      return mapSocialPostServiceError(error);
    }
  });
}

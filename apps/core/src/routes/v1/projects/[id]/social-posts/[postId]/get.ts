import { createRoute } from "@hono/zod-openapi";

import { requireCalendarBetaAccess } from "@/helpers/calendar-beta-access";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  socialPostParamsSchema,
  socialPostSchema,
} from "@/schemas/social-post.schema";
import { getSocialPost } from "@/services/social-posts.service";

import { mapSocialPostServiceError } from "../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-posts/{postId}",
    description:
      "Read one Social post of a Project. Requires an interactive session or an authorized task-capable Coworker with user context and Calendar beta access in the Project's Workspace. Publish now remains human-only.",
    tags: ["Projects"],
    request: { params: socialPostParamsSchema },
    responses: {
      200: jsonSuccessResponse(socialPostSchema, "Social post"),
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
    await requireCalendarBetaAccess(userContext.userId, prisma);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, postId } = c.req.valid("param");

    try {
      const post = await getSocialPost({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        postId,
      });
      return ok(
        c,
        socialPostSchema.parse({
          ...post,
          canPublishNow: post.canPublishNow && !userContext.coworkerId,
        }),
      );
    } catch (error) {
      return mapSocialPostServiceError(error);
    }
  });
}

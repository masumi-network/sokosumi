import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
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
import { duplicateSocialPost } from "@/services/social-posts.service";

import { mapSocialPostServiceError } from "../../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/social-posts/{postId}/duplicate",
    description:
      "Copy a published, failed, or missed Social post into a new draft. Copies text, media, provider, and the linked account when it is still connected. Does not copy the provider post id, schedule, or statistics. Requires an interactive session or an authorized task-capable Coworker with user context and Calendar beta access in the Project's Workspace.",
    tags: ["Projects"],
    request: { params: socialPostParamsSchema },
    responses: {
      201: jsonSuccessResponse(socialPostSchema, "Social post duplicated"),
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
    await requireSocialBetaAccess(userContext.userId, prisma);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, postId } = c.req.valid("param");

    try {
      const post = await duplicateSocialPost({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        coworkerId: userContext.coworkerId,
        organizationId: workspaceContext.organizationId,
        postId,
      });
      return created(
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

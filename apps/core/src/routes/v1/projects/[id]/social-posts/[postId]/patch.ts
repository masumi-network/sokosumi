import { createRoute } from "@hono/zod-openapi";

import { requireCalendarBetaAccess } from "@/helpers/calendar-beta-access";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  socialPostParamsSchema,
  socialPostSchema,
  updateSocialPostRequestSchema,
} from "@/schemas/social-post.schema";
import { updateSocialPost } from "@/services/social-posts.service";

import { mapSocialPostServiceError } from "../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/{id}/social-posts/{postId}",
    description:
      "Edit a draft or scheduled Social post. The body must carry the revision the client last observed. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: socialPostParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: updateSocialPostRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(socialPostSchema, "Social post updated"),
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
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    await requireCalendarBetaAccess(userContext.userId, prisma);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, postId } = c.req.valid("param");
    const input = c.req.valid("json");

    try {
      const post = await updateSocialPost({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        postId,
        organizationId: workspaceContext.organizationId,
        text: input.text,
        media: input.media,
        socialConnectionId: input.socialConnectionId,
        revision: input.revision,
      });
      return ok(c, socialPostSchema.parse(post));
    } catch (error) {
      return mapSocialPostServiceError(error);
    }
  });
}

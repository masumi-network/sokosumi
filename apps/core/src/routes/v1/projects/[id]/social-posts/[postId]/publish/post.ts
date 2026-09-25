import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  publishSocialPostRequestSchema,
  socialPostParamsSchema,
  socialPostSchema,
} from "@/schemas/social-post.schema";
import { publishSocialPostNow } from "@/services/social-post-publisher.service";

import { mapSocialPostServiceError } from "../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/social-posts/{postId}/publish",
    description:
      "Publish a Social post now through its Project social connection. Allowed from DRAFT, SCHEDULED, FAILED and MISSED; the attempt runs inline and the returned post carries its outcome. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: socialPostParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: publishSocialPostRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        socialPostSchema,
        "Social post publish attempted",
      ),
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
    await requireSocialBetaAccess(userContext.userId, prisma);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, postId } = c.req.valid("param");
    const input = c.req.valid("json");

    try {
      const post = await publishSocialPostNow({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        postId,
        revision: input.revision,
      });
      return ok(c, socialPostSchema.parse(post));
    } catch (error) {
      return mapSocialPostServiceError(error);
    }
  });
}

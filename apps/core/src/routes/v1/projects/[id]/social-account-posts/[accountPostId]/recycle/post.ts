import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  recycleSocialAccountPostRequestSchema,
  socialAccountPostParamsSchema,
} from "@/schemas/social-account-statistics.schema";
import { socialPostSchema } from "@/schemas/social-post.schema";
import { recycleSocialAccountPost } from "@/services/social-posts.service";

import { mapSocialPostServiceError } from "../../../social-posts/route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/social-account-posts/{accountPostId}/recycle",
    description:
      "Copy a Performance post into a new Social draft. Uses the original Sokosumi post when one matches, otherwise the imported text. Optional delayDays schedules that draft. Nothing is posted unless a delay is chosen. Requires an interactive session or an authorized task-capable Coworker with user context.",
    tags: ["Projects"],
    request: {
      params: socialAccountPostParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: recycleSocialAccountPostRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(socialPostSchema, "Social post recycled"),
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
    const { id: projectId, accountPostId } = c.req.valid("param");
    const input = c.req.valid("json");

    try {
      const post = await recycleSocialAccountPost({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        coworkerId: userContext.coworkerId,
        organizationId: workspaceContext.organizationId,
        accountPostId,
        delayDays: input.delayDays,
        timezone: input.timezone,
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

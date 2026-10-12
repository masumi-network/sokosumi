import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
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
import { refreshSocialPostStatistics } from "@/services/social-post-statistics.service";
import { mapSocialPostServiceError } from "../../../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/social-posts/{postId}/statistics/refresh",
    description:
      "Fetch lifetime performance counters through the post's original connected account. Updates only the statistics cache and preserves previous measurements on failure. Requires the same authorized Project/workspace access as Social post reads.",
    tags: ["Projects"],
    request: { params: socialPostParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        socialPostSchema,
        "Social post statistics refreshed",
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
    const actor = await requireSocialPostActor(c.var.authContext);
    await requireSocialBetaAccess(actor.userId, prisma);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, postId } = c.req.valid("param");
    try {
      const post = await refreshSocialPostStatistics({
        projectId,
        workspaceId,
        postId,
        userId: actor.userId,
      });
      return ok(
        c,
        socialPostSchema.parse({
          ...post,
          canPublishNow: post.canPublishNow && !actor.coworkerId,
        }),
      );
    } catch (error) {
      return mapSocialPostServiceError(error);
    }
  });
}

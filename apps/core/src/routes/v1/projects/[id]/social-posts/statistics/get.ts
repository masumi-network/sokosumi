import { createRoute, z } from "@hono/zod-openapi";
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
  socialPostProjectParamsSchema,
  socialPostSchema,
} from "@/schemas/social-post.schema";
import {
  socialPostStatisticsQuerySchema,
  socialPostStatisticsSummarySchema,
} from "@/schemas/social-post-statistics.schema";
import { listSocialPostStatistics } from "@/services/social-post-statistics.service";
import { mapSocialPostServiceError } from "../route-helpers.js";

const responseSchema = z
  .object({
    posts: z.array(socialPostSchema),
    summary: z.array(socialPostStatisticsSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .openapi("SocialPostStatisticsPage");

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-posts/statistics",
    description:
      "Read cached lifetime post statistics. Filters select publication dates, not engagement dates. Platform summaries sum available counters across all matching posts; unavailable counters are null. Requires the same authorized Project/workspace access as Social post reads.",
    tags: ["Projects"],
    request: {
      params: socialPostProjectParamsSchema,
      query: socialPostStatisticsQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(responseSchema, "Social post statistics"),
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
    const actor = await requireSocialPostActor(c.var.authContext);
    await requireSocialBetaAccess(actor.userId, prisma);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const { publishedFrom, publishedUntil, ...query } = c.req.valid("query");
    try {
      const result = await listSocialPostStatistics({
        projectId,
        workspaceId,
        ...query,
        publishedFrom: publishedFrom ? new Date(publishedFrom) : undefined,
        publishedUntil: publishedUntil ? new Date(publishedUntil) : undefined,
      });
      return ok(
        c,
        responseSchema.parse({
          ...result,
          posts: result.posts.map((post) => ({
            ...post,
            canPublishNow: post.canPublishNow && !actor.coworkerId,
          })),
        }),
      );
    } catch (error) {
      return mapSocialPostServiceError(error);
    }
  });
}

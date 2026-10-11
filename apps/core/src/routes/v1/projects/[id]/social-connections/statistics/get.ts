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
import { projectSocialConnectionProjectParamsSchema } from "@/schemas/project-social-connection.schema";
import {
  socialAccountStatisticsPageSchema,
  socialAccountStatisticsQuerySchema,
} from "@/schemas/social-account-statistics.schema";
import { listSocialAccountStatistics } from "@/services/social-account-statistics.service";
import { mapProjectSocialConnectionServiceError } from "../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-connections/statistics",
    tags: ["Projects"],
    description:
      "Read cached account metrics and provider-authored published posts, including posts published outside Sokosumi. Account totals and the posting-consistency calendar are independent of publication-date filters and post pagination. Headline totals cover the filtered cohort, not only the current page. History completeness and failures are explicit; GET does not fetch provider history.",
    request: {
      params: projectSocialConnectionProjectParamsSchema,
      query: socialAccountStatisticsQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        socialAccountStatisticsPageSchema,
        "Social account statistics",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);
export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const actor = await requireSocialPostActor(c.var.authContext);
    await requireSocialBetaAccess(actor.userId, prisma);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const { publishedFrom, publishedUntil, ...query } = c.req.valid("query");
    try {
      const result = await listSocialAccountStatistics({
        projectId,
        workspaceId,
        ...query,
        publishedFrom: publishedFrom ? new Date(publishedFrom) : undefined,
        publishedUntil: publishedUntil ? new Date(publishedUntil) : undefined,
      });
      return ok(c, socialAccountStatisticsPageSchema.parse(result));
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}

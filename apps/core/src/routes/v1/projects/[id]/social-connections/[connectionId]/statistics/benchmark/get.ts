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
import { projectSocialConnectionParamsSchema } from "@/schemas/project-social-connection.schema";
import {
  socialPerformanceBenchmarkQuerySchema,
  socialPerformanceBenchmarkResponseSchema,
  socialStatisticsResearchErrorResponseSchema,
} from "@/schemas/social-statistics-research.schema";
import { readSocialPerformanceBenchmark } from "@/services/social-statistics-research.service";
import { mapProjectSocialConnectionServiceError } from "../../../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-connections/{connectionId}/statistics/benchmark",
    tags: ["Projects"],
    description:
      "Read public X profile metrics and up to 100 original or quote posts from the last 90 days. Uses the selected authorized connection and the same Performance headline totals as owned accounts; private metrics are excluded.",
    request: {
      params: projectSocialConnectionParamsSchema,
      query: socialPerformanceBenchmarkQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        socialPerformanceBenchmarkResponseSchema,
        "X public benchmark",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse(
        "Forbidden or X endpoint access denied",
        socialStatisticsResearchErrorResponseSchema,
      ),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse(
        "Invalid request or X reconnection required",
        socialStatisticsResearchErrorResponseSchema,
      ),
      429: jsonErrorResponse(
        "X rate limited; retry after the indicated delay",
        socialStatisticsResearchErrorResponseSchema,
      ),
      502: jsonErrorResponse(
        "X or connector returned an unusable response",
        socialStatisticsResearchErrorResponseSchema,
      ),
      503: jsonErrorResponse(
        "X or connector temporarily unavailable",
        socialStatisticsResearchErrorResponseSchema,
      ),
    },
  }),
);
export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const actor = await requireSocialPostActor(c.var.authContext);
    await requireSocialBetaAccess(actor.userId, prisma);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, connectionId } = c.req.valid("param");
    try {
      return ok(
        c,
        await readSocialPerformanceBenchmark({
          projectId,
          workspaceId,
          connectionId,
          ...c.req.valid("query"),
        }),
      );
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}

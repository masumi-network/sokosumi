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
  socialPerformanceQuerySchema,
  socialPerformanceResponseSchema,
} from "@/schemas/social-performance.schema";
import { listSocialPerformance } from "@/services/social-performance.service";
import { mapProjectSocialConnectionServiceError } from "../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-connections/performance",
    tags: ["Projects"],
    description:
      "Read complete cached publication-cohort performance, comparisons, posting-time samples, and measured daily snapshots. Totals are latest lifetime counters for posts published in each range, not engagement earned during that range. Engagement-rate formulas and measurement coverage are explicit. Returns up to 100 ranked posts per offset page; aggregate summaries cover the whole matching cohort. GET does not refresh providers or backfill historical samples.",
    request: {
      params: projectSocialConnectionProjectParamsSchema,
      query: socialPerformanceQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        socialPerformanceResponseSchema,
        "Social account performance",
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
    try {
      const result = await listSocialPerformance({
        projectId,
        workspaceId,
        ...c.req.valid("query"),
      });
      return ok(c, socialPerformanceResponseSchema.parse(result));
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}

import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialResearchScope } from "@/helpers/social-post-access";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { projectSocialConnectionParamsSchema } from "@/schemas/project-social-connection.schema";
import {
  socialPerformanceBenchmarkQuerySchema,
  socialPerformanceBenchmarkResponseSchema,
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
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);
export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { id: projectId, connectionId } = c.req.valid("param");
    const { workspaceId } = await requireSocialResearchScope(
      c.var.authContext,
      projectId,
      c.var.workspaceContext,
    );
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

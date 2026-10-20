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
  socialPerformanceAudienceQuerySchema,
  socialPerformanceAudienceResponseSchema,
} from "@/schemas/social-statistics-research.schema";
import { readSocialPerformanceAudience } from "@/services/social-statistics-research.service";
import { mapProjectSocialConnectionServiceError } from "../../../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-connections/{connectionId}/statistics/audience",
    tags: ["Projects"],
    description:
      "Read one page of public X followers, recent mentions, or a cached own post's likers/reposters through the selected connected account. Returns explicit sample coverage; does not persist audience profiles or infer demographics.",
    request: {
      params: projectSocialConnectionParamsSchema,
      query: socialPerformanceAudienceQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        socialPerformanceAudienceResponseSchema,
        "X audience sample",
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
        await readSocialPerformanceAudience({
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

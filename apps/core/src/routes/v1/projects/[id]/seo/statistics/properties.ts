import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireSeoRouteActor } from "@/helpers/project-seo-access";
import { ok } from "@/helpers/response";
import {
  OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { seoProjectParamsSchema } from "@/schemas/project-seo.schema";
import {
  projectSeoStatisticsPropertiesSchema,
  seoStatisticsProviderQuerySchema,
} from "@/schemas/project-seo-statistics.schema";
import { listProjectSeoStatisticsProperties } from "@/services/project-seo-statistics.service";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/properties",
    operationId: "listProjectSeoStatisticsProperties",
    tags: ["Projects"],
    request: {
      params: seoProjectParamsSchema,
      query: seoStatisticsProviderQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        projectSeoStatisticsPropertiesSchema,
        "Native statistics properties",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not found"),
      422: jsonErrorResponse("Invalid statistics request"),
    },
  }),
);
app.openapi(route, async (c) => {
  const { id } = c.req.valid("param");
  const actor = requireSeoRouteActor(
    {
      authContext: c.get("authContext"),
      workspaceContext: c.get("workspaceContext"),
    },
    id,
  );
  return ok(
    c,
    await listProjectSeoStatisticsProperties(
      actor,
      c.req.valid("query").provider,
    ),
  );
});
export default app;

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

export function createSeoStatisticsPropertiesRouter(
  ownerKind: "project" | "audit",
) {
  const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
  const route = withOrganizationSlugHeaderParameter(
    createRoute({
      method: "get",
      path: "/properties",
      operationId:
        ownerKind === "audit"
          ? "listSeoAuditStatisticsProperties"
          : "listProjectSeoStatisticsProperties",
      tags: ownerKind === "audit" ? ["SEO"] : ["Projects"],
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
      { kind: ownerKind, id },
    );
    return ok(
      c,
      await listProjectSeoStatisticsProperties(
        actor,
        c.req.valid("query").provider,
      ),
    );
  });
  return app;
}

import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireSeoRouteActor } from "@/helpers/project-seo-access";
import { ok } from "@/helpers/response";
import {
  OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireFirstPartyUserAuthContext } from "@/middleware/auth";
import { seoProjectParamsSchema } from "@/schemas/project-seo.schema";
import {
  siteTrafficInput,
  siteTrafficReport,
} from "@/schemas/seo-site-traffic.schema";
import { getSeoSiteTraffic } from "@/services/seo-site-traffic";

export function createSeoSiteTrafficRouter(ownerKind: "project" | "audit") {
  const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path: "/traffic",
        operationId:
          ownerKind === "audit"
            ? "readAuditSiteTraffic"
            : "readProjectSiteTraffic",
        tags: ["SEO"],
        request: {
          params: seoProjectParamsSchema,
          body: {
            required: true,
            content: { "application/json": { schema: siteTrafficInput } },
          },
        },
        responses: {
          200: jsonSuccessResponse(
            siteTrafficReport,
            "Private Search Console traffic for the open website",
          ),
          401: jsonErrorResponse("Unauthorized"),
          403: jsonErrorResponse("Forbidden"),
          404: jsonErrorResponse("Website unavailable"),
          409: jsonErrorResponse("Connection changed"),
          422: jsonErrorResponse("Traffic unavailable"),
        },
      }),
    ),
    async (c) => {
      requireFirstPartyUserAuthContext(c.var.authContext);
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      c.header("Cache-Control", "private, no-store");
      return ok(c, await getSeoSiteTraffic(actor, c.req.valid("json")));
    },
  );
  return app;
}

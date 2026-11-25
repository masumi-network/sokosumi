import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  adminSeoImpactQuery,
  adminSeoImpactVerdicts,
} from "@/schemas/seo-impact.schema";
import { listAdminSeoImpactVerdicts } from "@/services/admin-seo-impact";

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/seo-impact",
      operationId: "listAdminSeoImpactVerdicts",
      tags: ["Admin"],
      description:
        "Page changes tracked for an SEO impact verdict across customers: the change, Google's first crawl after it, and the measured window.",
      request: { query: adminSeoImpactQuery },
      responses: {
        200: jsonSuccessResponse(
          adminSeoImpactVerdicts,
          "Tracked SEO page changes",
        ),
        401: jsonErrorResponse("Unauthorized"),
        403: jsonErrorResponse("Forbidden"),
      },
    }),
    async (c) => {
      requireAdminAuthContext(c.var.authContext);
      return ok(c, await listAdminSeoImpactVerdicts(c.req.valid("query")));
    },
  );
}

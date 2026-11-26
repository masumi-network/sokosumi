import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  adminSeoActionImpactQuery,
  adminSeoActionImpactSchema,
} from "@/schemas/seo-action-impact.schema";
import { listAdminSeoActionImpact } from "@/services/admin-seo-action-impact";

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/seo-action-impact",
      operationId: "listAdminSeoActionImpact",
      tags: ["Admin"],
      description:
        "Search Console totals before and after each done SEO action, per audit and owner. Stored rows only.",
      request: { query: adminSeoActionImpactQuery },
      responses: {
        200: jsonSuccessResponse(
          adminSeoActionImpactSchema,
          "Impact of done SEO actions",
        ),
        401: jsonErrorResponse("Unauthorized"),
        403: jsonErrorResponse("Forbidden"),
      },
    }),
    async (c) => {
      requireAdminAuthContext(c.var.authContext);
      return ok(c, await listAdminSeoActionImpact(c.req.valid("query")));
    },
  );
}

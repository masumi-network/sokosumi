import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  adminSeoAlertQuery,
  adminSeoAlerts,
} from "@/schemas/admin-seo-alerts.schema";
import { listAdminSeoAlerts } from "@/services/admin-seo-alerts";

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/seo-alerts",
      operationId: "listAdminSeoAlerts",
      tags: ["Admin"],
      description:
        "Operational alerts and metered billing for full audits, including overdue runs.",
      request: { query: adminSeoAlertQuery },
      responses: {
        200: jsonSuccessResponse(adminSeoAlerts, "SEO audit alerts"),
        401: jsonErrorResponse("Unauthorized"),
        403: jsonErrorResponse("Forbidden"),
      },
    }),
    async (c) => {
      requireAdminAuthContext(c.var.authContext);
      return ok(c, await listAdminSeoAlerts(c.req.valid("query")));
    },
  );
}

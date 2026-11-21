import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { seoTaskSearchConsoleStatusSchema } from "@/schemas/seo-task-search-console.schema";
import { getSeoTaskSearchConsoleStatus } from "@/services/seo-task-search-console.service";

const route = createRoute({
  method: "get",
  path: "/{id}/integrations/search-console",
  tags: ["Tasks"],
  description:
    "Whether the configured SEO worker can read Search Console through Core for this full-audit Task. Only the account and property frozen when the audit was approved count. No credential or account id is returned.",
  request: { params: z.object({ id: z.string().min(1).max(128) }) },
  responses: {
    200: jsonSuccessResponse(
      seoTaskSearchConsoleStatusSchema,
      "Search Console status for the audit Task",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    c.header("Cache-Control", "no-store");
    return ok(
      c,
      await getSeoTaskSearchConsoleStatus(
        c.var.authContext,
        c.req.valid("param").id,
      ),
    );
  });
}

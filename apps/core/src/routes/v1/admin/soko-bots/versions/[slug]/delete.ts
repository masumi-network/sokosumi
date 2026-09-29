import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { archiveAuthoredVersion } from "@/services/soko-bot-version.service";

const archiveVersionRoute = createRoute({
  method: "delete",
  path: "/versions/{slug}",
  operationId: "archiveAdminSokoBotVersion",
  tags: ["Admin"],
  request: { params: z.object({ slug: z.string().min(2).max(41) }) },
  responses: {
    200: jsonSuccessResponse(z.object({ archived: z.boolean() }), "Archived"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(archiveVersionRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    await archiveAuthoredVersion(c.req.valid("param").slug);
    return ok(c, { archived: true });
  });
}

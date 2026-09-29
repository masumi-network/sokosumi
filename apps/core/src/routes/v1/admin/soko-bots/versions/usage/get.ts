import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { adminSokoBotVersionUsageSchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";

// What the fleet actually runs, counted in the database rather than derived
// from whatever page the caller happens to be holding.
const versionUsageRoute = createRoute({
  method: "get",
  path: "/versions/usage",
  operationId: "getAdminSokoBotVersionUsage",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      adminSokoBotVersionUsageSchema,
      "Live bots per version",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(versionUsageRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    return ok(
      c,
      adminSokoBotVersionUsageSchema.parse({
        versions: await sokoBotControlPlane.versionUsage(),
      }),
    );
  });
}

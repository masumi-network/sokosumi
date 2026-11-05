import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  adminSokoBotFleetDaysQuerySchema,
  adminSokoBotFleetDaysSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotFleetDays } from "@/services/soko-bot-usage.service";

// Per UTC day across every bot: people who wrote to one, and the model cost.
const fleetDaysRoute = createRoute({
  method: "get",
  path: "/daily",
  operationId: "getAdminSokoBotFleetDays",
  tags: ["Admin"],
  request: { query: adminSokoBotFleetDaysQuerySchema },
  responses: {
    200: jsonSuccessResponse(adminSokoBotFleetDaysSchema, "Fleet per day"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(fleetDaysRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { days } = c.req.valid("query");
    return ok(
      c,
      adminSokoBotFleetDaysSchema.parse({ days: await sokoBotFleetDays(days) }),
    );
  });
}

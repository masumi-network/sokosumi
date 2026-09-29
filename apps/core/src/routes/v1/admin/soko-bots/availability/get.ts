import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { sokoBotAvailabilitySchema } from "@/schemas/soko-bot.schema";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";

const availabilityRoute = createRoute({
  method: "get",
  path: "/availability",
  operationId: "getAdminSokoBotAvailability",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(sokoBotAvailabilitySchema, "Feature availability"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(availabilityRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const availability = await getSokoBotAvailability();
    return ok(c, {
      disabled: availability.disabled,
      disabledAt: availability.disabledAt?.toISOString() ?? null,
      disabledReason: availability.disabledReason,
    });
  });
}

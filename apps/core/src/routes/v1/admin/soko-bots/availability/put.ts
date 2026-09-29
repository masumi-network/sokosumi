import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  setSokoBotAvailabilityRequestSchema,
  sokoBotAvailabilitySchema,
} from "@/schemas/soko-bot.schema";
import { setSokoBotDisabled } from "@/services/soko-bot-availability.service";

const setAvailabilityRoute = createRoute({
  method: "put",
  path: "/availability",
  operationId: "setAdminSokoBotAvailability",
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": { schema: setSokoBotAvailabilityRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotAvailabilitySchema, "Feature availability"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(setAvailabilityRoute, async (c) => {
    const auth = requireAdminAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    const availability = await setSokoBotDisabled({
      disabled: body.disabled,
      adminUserId: auth.userId,
      reason: body.reason ?? null,
    });
    return ok(c, {
      disabled: availability.disabled,
      disabledAt: availability.disabledAt?.toISOString() ?? null,
      disabledReason: availability.disabledReason,
    });
  });
}

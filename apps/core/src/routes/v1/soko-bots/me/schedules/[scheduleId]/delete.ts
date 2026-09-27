import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapControlPlaneError, scheduleParams } from "../../../helpers.js";

const deleteScheduleRoute = createRoute({
  method: "delete",
  path: "/me/schedules/{scheduleId}",
  operationId: "deleteMySokoBotSchedule",
  tags: ["Soko Bots"],
  request: { params: scheduleParams },
  responses: {
    200: jsonSuccessResponse(
      z.object({ deleted: z.literal(true) }),
      "Delete Soko Bot schedule",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(deleteScheduleRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    try {
      await sokoBotControlPlane.deleteSchedule(
        auth.userId,
        c.req.valid("param").scheduleId,
      );
      return ok(c, { deleted: true as const });
    } catch (error) {
      mapControlPlaneError(error);
    }
  });
}

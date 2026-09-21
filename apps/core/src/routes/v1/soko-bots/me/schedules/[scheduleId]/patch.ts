import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  sokoBotScheduleSchema,
  updateSokoBotScheduleRequestSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapControlPlaneError, scheduleParams } from "../../../helpers.js";

const updateScheduleRoute = createRoute({
  method: "patch",
  path: "/me/schedules/{scheduleId}",
  operationId: "updateMySokoBotSchedule",
  tags: ["Soko Bots"],
  request: {
    params: scheduleParams,
    body: {
      content: {
        "application/json": { schema: updateSokoBotScheduleRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotScheduleSchema, "Update Soko Bot schedule"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(updateScheduleRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    try {
      const schedule = await sokoBotControlPlane.updateSchedule({
        userId: auth.userId,
        scheduleId: c.req.valid("param").scheduleId,
        ...c.req.valid("json"),
      });
      return ok(c, sokoBotScheduleSchema.parse(schedule));
    } catch (error) {
      mapControlPlaneError(error);
    }
  });
}

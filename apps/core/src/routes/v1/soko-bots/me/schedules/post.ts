import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createSokoBotScheduleRequestSchema,
  sokoBotScheduleSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapControlPlaneError } from "../../helpers.js";

const createScheduleRoute = createRoute({
  method: "post",
  path: "/me/schedules",
  operationId: "createMySokoBotSchedule",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: createSokoBotScheduleRequestSchema },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(sokoBotScheduleSchema, "Create Soko Bot schedule"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(createScheduleRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const schedule = await sokoBotControlPlane.createSchedule({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        ...c.req.valid("json"),
      });
      return created(c, sokoBotScheduleSchema.parse(schedule));
    } catch (error) {
      mapControlPlaneError(error);
    }
  });
}

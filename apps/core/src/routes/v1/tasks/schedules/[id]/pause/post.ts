import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  taskScheduleParamsSchema,
  taskScheduleSchema,
} from "@/schemas/task-schedule.schema";
import {
  changeTaskScheduleState,
  mapTaskSchedule,
} from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/schedules/{id}/pause",
    description:
      "Pause an Active Task Schedule. No Occurrence creates a Task while it is Paused.",
    tags: ["Task Schedules"],
    request: { params: taskScheduleParamsSchema },
    responses: {
      200: jsonSuccessResponse(taskScheduleSchema, "Task Schedule"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const schedule = await changeTaskScheduleState(
      c.var,
      c.req.valid("param").id,
      "pause",
    );
    return ok(c, taskScheduleSchema.parse(mapTaskSchedule(schedule)));
  });
}

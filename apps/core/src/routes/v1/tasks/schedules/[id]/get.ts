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
  getTaskSchedule,
  mapTaskSchedule,
} from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/schedules/{id}",
    description: "Get a Task Schedule",
    tags: ["Task Schedules"],
    request: { params: taskScheduleParamsSchema },
    responses: {
      200: jsonSuccessResponse(taskScheduleSchema, "Task Schedule"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const schedule = await getTaskSchedule(c.var, c.req.valid("param").id);
    return ok(c, taskScheduleSchema.parse(mapTaskSchedule(schedule)));
  });
}

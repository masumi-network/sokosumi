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
  updateTaskScheduleRequestSchema,
} from "@/schemas/task-schedule.schema";
import {
  mapTaskSchedule,
  updateTaskSchedule,
} from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/schedules/{id}",
    description:
      "Change a Task Schedule's rule or blueprint. Revision-checked; changes future Occurrences only.",
    tags: ["Task Schedules"],
    request: {
      params: taskScheduleParamsSchema,
      body: {
        content: {
          "application/json": { schema: updateTaskScheduleRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(taskScheduleSchema, "Task Schedule updated"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const schedule = await updateTaskSchedule(
      c.var,
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return ok(c, taskScheduleSchema.parse(mapTaskSchedule(schedule)));
  });
}

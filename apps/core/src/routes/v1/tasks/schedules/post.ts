import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  createTaskScheduleRequestSchema,
  taskScheduleSchema,
} from "@/schemas/task-schedule.schema";
import {
  createTaskSchedule,
  mapTaskSchedule,
} from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/schedules",
    description:
      "Create a Task Schedule: a repeating rule plus the blueprint of the Task each Occurrence creates.",
    tags: ["Task Schedules"],
    request: {
      body: {
        content: {
          "application/json": { schema: createTaskScheduleRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(taskScheduleSchema, "Task Schedule created"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const schedule = await createTaskSchedule(c.var, c.req.valid("json"));
    return created(c, taskScheduleSchema.parse(mapTaskSchedule(schedule)));
  });
}

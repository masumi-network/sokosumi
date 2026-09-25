import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { taskScheduleParamsSchema } from "@/schemas/task-schedule.schema";
import { deleteTaskSchedule } from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/schedules/{id}",
    description:
      "Delete a Task Schedule. Tasks it already created stay and stop pointing to it.",
    tags: ["Task Schedules"],
    request: { params: taskScheduleParamsSchema },
    responses: {
      204: { description: "Task Schedule deleted" },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    await deleteTaskSchedule(c.var, c.req.valid("param").id);
    return empty(c);
  });
}

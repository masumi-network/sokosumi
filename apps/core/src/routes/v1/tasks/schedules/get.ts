import { createRoute, z } from "@hono/zod-openapi";

import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  taskScheduleListQuerySchema,
  taskScheduleSchema,
} from "@/schemas/task-schedule.schema";
import {
  listTaskSchedules,
  mapTaskSchedule,
} from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/schedules",
    description:
      "List the active workspace's Task Schedules, newest first (paginated)",
    tags: ["Task Schedules"],
    request: { query: taskScheduleListQuerySchema },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(taskScheduleSchema),
        "Task Schedules",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { schedules, pagination } = await listTaskSchedules(
      c.var,
      c.req.valid("query"),
    );
    return ok(
      c,
      z.array(taskScheduleSchema).parse(schedules.map(mapTaskSchedule)),
      pagination,
    );
  });
}

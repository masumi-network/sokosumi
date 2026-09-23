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
  taskScheduleParamsSchema,
  taskScheduleRunListQuerySchema,
  taskScheduleRunSchema,
} from "@/schemas/task-schedule.schema";
import {
  listTaskScheduleRuns,
  mapTaskScheduleRun,
} from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/schedules/{id}/runs",
    description:
      "List a Task Schedule's Runs in time order (paginated): the ones that created Tasks, the skipped and moved ones, and the planned ones up to the projection horizon.",
    tags: ["Task Schedules"],
    request: {
      params: taskScheduleParamsSchema,
      query: taskScheduleRunListQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(z.array(taskScheduleRunSchema), "Runs"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { runs, pagination } = await listTaskScheduleRuns(
      c.var,
      c.req.valid("param").id,
      c.req.valid("query"),
    );
    return ok(
      c,
      z.array(taskScheduleRunSchema).parse(runs.map(mapTaskScheduleRun)),
      pagination,
    );
  });
}

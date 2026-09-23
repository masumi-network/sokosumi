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
  scheduleOccurrenceListQuerySchema,
  scheduleOccurrenceSchema,
  taskScheduleParamsSchema,
} from "@/schemas/task-schedule.schema";
import {
  listTaskScheduleOccurrences,
  mapScheduleOccurrence,
} from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/schedules/{id}/occurrences",
    description:
      "List a Task Schedule's Occurrences in time order (paginated): the ones that created Tasks, the skipped and moved ones, and the planned ones up to the projection horizon.",
    tags: ["Task Schedules"],
    request: {
      params: taskScheduleParamsSchema,
      query: scheduleOccurrenceListQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(scheduleOccurrenceSchema),
        "Occurrences",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { occurrences, pagination } = await listTaskScheduleOccurrences(
      c.var,
      c.req.valid("param").id,
      c.req.valid("query"),
    );
    return ok(
      c,
      z
        .array(scheduleOccurrenceSchema)
        .parse(occurrences.map(mapScheduleOccurrence)),
      pagination,
    );
  });
}

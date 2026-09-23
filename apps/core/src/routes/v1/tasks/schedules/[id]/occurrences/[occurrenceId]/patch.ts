import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  scheduleOccurrenceUpdateSchema,
  taskScheduleOccurrenceParamsSchema,
  updateScheduleOccurrenceRequestSchema,
} from "@/schemas/task-schedule.schema";
import {
  changeTaskScheduleOccurrence,
  mapScheduleOccurrence,
} from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/schedules/{id}/occurrences/{occurrenceId}",
    description:
      "Skip, move, or restore one upcoming Occurrence without changing the rule. Only future Occurrences that have not created their Task, inside the projection horizon, of an Active schedule. Revision-checked.",
    tags: ["Task Schedules"],
    request: {
      params: taskScheduleOccurrenceParamsSchema,
      body: {
        content: {
          "application/json": { schema: updateScheduleOccurrenceRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        scheduleOccurrenceUpdateSchema,
        "Occurrence changed",
      ),
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
    const { id, occurrenceId } = c.req.valid("param");
    const { revision, occurrence } = await changeTaskScheduleOccurrence(
      c.var,
      id,
      occurrenceId,
      c.req.valid("json"),
    );
    return ok(
      c,
      scheduleOccurrenceUpdateSchema.parse({
        revision,
        occurrence: mapScheduleOccurrence(occurrence),
      }),
    );
  });
}

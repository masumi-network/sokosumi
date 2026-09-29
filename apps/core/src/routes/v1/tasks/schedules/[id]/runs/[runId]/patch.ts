import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  taskScheduleRunParamsSchema,
  taskScheduleRunUpdateSchema,
  updateTaskScheduleRunRequestSchema,
} from "@/schemas/task-schedule.schema";
import {
  changeTaskScheduleRun,
  mapTaskScheduleRun,
} from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/schedules/{id}/runs/{runId}",
    description:
      "Skip, move, or restore one upcoming Run without changing the rule. Only future Runs that have not created their Task, inside the projection horizon, of an Active schedule. Revision-checked.",
    tags: ["Task Schedules"],
    request: {
      params: taskScheduleRunParamsSchema,
      body: {
        content: {
          "application/json": { schema: updateTaskScheduleRunRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(taskScheduleRunUpdateSchema, "Run changed"),
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
    const { id, runId } = c.req.valid("param");
    const { revision, run } = await changeTaskScheduleRun(
      c.var,
      id,
      runId,
      c.req.valid("json"),
    );
    return ok(
      c,
      taskScheduleRunUpdateSchema.parse({
        revision,
        run: mapTaskScheduleRun(run),
      }),
    );
  });
}

import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  createTaskScheduleRunRequestSchema,
  taskScheduleParamsSchema,
  taskScheduleRunUpdateSchema,
} from "@/schemas/task-schedule.schema";
import {
  mapTaskScheduleRun,
  runTaskScheduleNow,
} from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/schedules/{id}/runs",
    description:
      "Run now: create one extra Run of an Active or Paused Task Schedule, which creates its Task at once. The rule and its planned Runs stay as they are, and the Run does not count toward an end-after-N rule. Revision-checked.",
    tags: ["Task Schedules"],
    request: {
      params: taskScheduleParamsSchema,
      body: {
        content: {
          "application/json": { schema: createTaskScheduleRunRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(taskScheduleRunUpdateSchema, "Run created"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { revision, run } = await runTaskScheduleNow(
      c.var,
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return created(
      c,
      taskScheduleRunUpdateSchema.parse({
        revision,
        run: mapTaskScheduleRun(run),
      }),
    );
  });
}

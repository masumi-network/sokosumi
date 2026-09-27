import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { errorResponseWithExtensionsSchema, gone } from "@/helpers/error";
import { jsonContent } from "@/helpers/openapi";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

const pathParam = (name: string) =>
  z.string().openapi({ param: { name, in: "path" } });

const taskParams = z.object({ id: pathParam("id") });
const occurrenceParams = taskParams.extend({
  occurrenceId: pathParam("occurrenceId"),
});

const MOVED_ROUTES = [
  {
    method: "post",
    path: "/scheduled",
    params: undefined,
    replacement: "POST /v1/tasks/schedules",
  },
  {
    method: "put",
    path: "/{id}/schedule",
    params: taskParams,
    replacement: "POST /v1/tasks/schedules",
  },
  {
    method: "delete",
    path: "/{id}/schedule",
    params: taskParams,
    replacement: "DELETE /v1/tasks/schedules/{id}",
  },
  {
    method: "put",
    path: "/{id}/calendar-schedule",
    params: taskParams,
    replacement: "PATCH /v1/tasks/schedules/{id}",
  },
  {
    method: "put",
    path: "/{id}/calendar-source",
    params: taskParams,
    replacement: "PATCH /v1/tasks/schedules/{id}",
  },
  {
    method: "get",
    path: "/{id}/schedule/occurrences",
    params: taskParams,
    replacement: "GET /v1/tasks/schedules/{id}/runs",
  },
  {
    method: "patch",
    path: "/{id}/schedule/occurrences/{occurrenceId}",
    params: occurrenceParams,
    replacement: "PATCH /v1/tasks/schedules/{id}/runs/{runId}",
  },
] as const;

const movedResponseSchema = errorResponseWithExtensionsSchema(
  {
    replacement: z.string().openapi({ example: "POST /v1/tasks/schedules" }),
  },
  "TaskScheduleMovedError",
);

/**
 * The per-Task schedule routes of the old series model. Repeating rules are
 * Task Schedules now (ADR 0041); each old route answers 410 with the route
 * that replaced it, and a one-time start is `runAt` on the Task.
 */
export default function mount(app: OpenAPIHonoWithAuth) {
  for (const moved of MOVED_ROUTES) {
    const route = createRoute({
      method: moved.method,
      path: moved.path,
      deprecated: true,
      description: `Removed. Repeating rules are Task Schedules; use ${moved.replacement}. A one-time start is \`runAt\` on POST /v1/tasks or PATCH /v1/tasks/{id}.`,
      tags: ["Tasks"],
      request: moved.params ? { params: moved.params } : {},
      responses: {
        410: {
          description: "Gone. Branch on `kind`: task_schedule_moved.",
          content: jsonContent(movedResponseSchema),
        },
      },
    });

    app.openapi(route, () => {
      throw gone(
        `This route was removed. Repeating rules are Task Schedules: use ${moved.replacement}. A one-time start is runAt on the Task.`,
        {
          kind: CORE_API_ERROR_KINDS.TASK_SCHEDULE_MOVED,
          extensions: { replacement: moved.replacement },
        },
      );
    });
  }
}

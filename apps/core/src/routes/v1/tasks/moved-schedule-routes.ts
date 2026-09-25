import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import {
  errorResponseWithExtensionsSchema,
  gone,
  notFound,
} from "@/helpers/error";
import {
  findTaskBlueprint,
  logLegacyTaskScheduleShimHit,
  mapLegacyCalendarScheduleToUpdate,
  mapLegacyCalendarSourceToUpdate,
  mapLegacyCreateToTaskSchedule,
  mapLegacyPutScheduleToUpdate,
  mapTaskBlueprintToCreate,
  mapTaskScheduleToLegacyProjection,
  parseLegacyCalendarScheduleBody,
  parseLegacyCalendarSourceBody,
  parseLegacyPutScheduleBody,
  requireLegacyTaskScheduleShim,
  requireResolvedTaskScheduleId,
  resolveTaskScheduleId,
  shimCreatedTaskScheduleId,
} from "@/helpers/legacy-task-schedule-shim";
import {
  jsonContent,
  jsonErrorResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import { created, empty, ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  legacyCreateScheduledTaskRequestSchema,
  legacyPutCalendarSourceRequestSchema,
  legacyPutCalendarTaskScheduleRequestSchema,
  legacyPutTaskScheduleRequestSchema,
  legacyTaskScheduleProjectionSchema,
} from "@/schemas/legacy-task-schedule.schema";
import {
  createTaskSchedule,
  deleteTaskSchedule,
  getTaskSchedule,
  updateTaskSchedule,
} from "@/services/task-schedule.service";

const pathParam = (name: string) =>
  z.string().openapi({ param: { name, in: "path" } });

const taskParams = z.object({ id: pathParam("id") });
const occurrenceParams = taskParams.extend({
  occurrenceId: pathParam("occurrenceId"),
});

const movedResponseSchema = errorResponseWithExtensionsSchema(
  {
    replacement: z.string().openapi({ example: "POST /v1/tasks/schedules" }),
  },
  "TaskScheduleMovedError",
);

const goneResponses = {
  410: {
    description: "Gone. Branch on `kind`: task_schedule_moved.",
    content: jsonContent(movedResponseSchema),
  },
};

const shimErrorResponses = {
  400: jsonErrorResponse("Bad Request"),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
  409: jsonErrorResponse("Conflict"),
  422: jsonErrorResponse("Unprocessable Entity"),
  ...goneResponses,
};

const SHIM_UNTIL =
  "Temporary adapter until 2026-09-29 (`LEGACY_TASK_SCHEDULE_SHIM`). Translates to `/v1/tasks/schedules`. A one-time start is `runAt` on POST /v1/tasks.";

const OCCURRENCE_ROUTES = [
  {
    method: "get" as const,
    path: "/{id}/schedule/occurrences",
    params: taskParams,
    replacement: "GET /v1/tasks/schedules/{id}/runs",
  },
  {
    method: "patch" as const,
    path: "/{id}/schedule/occurrences/{occurrenceId}",
    params: occurrenceParams,
    replacement: "PATCH /v1/tasks/schedules/{id}/runs/{runId}",
  },
];

function throwGone(replacement: string): never {
  throw gone(
    `This route was removed. Repeating rules are Task Schedules: use ${replacement}. A one-time start is runAt on the Task.`,
    {
      kind: CORE_API_ERROR_KINDS.TASK_SCHEDULE_MOVED,
      extensions: { replacement },
    },
  );
}

/**
 * Per-Task schedule routes of the old series model (ADR 0041).
 *
 * Temporary: until 2026-09-29, create / update / read / delete translate
 * to Task Schedule. Occurrence skip/move/restore stays 410.
 * Remove this adapter after the sunset.
 */
export default function mount(app: OpenAPIHonoWithAuth) {
  const createScheduled = withCoworkerContextHeaderParameters(
    createRoute({
      method: "post",
      path: "/scheduled",
      deprecated: true,
      description: `Create a repeating Task Schedule from the old POST /tasks/scheduled body. ${SHIM_UNTIL}`,
      tags: ["Tasks"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: legacyCreateScheduledTaskRequestSchema,
            },
          },
        },
      },
      responses: {
        201: jsonSuccessResponse(
          legacyTaskScheduleProjectionSchema,
          "Legacy schedule projection of the created Task Schedule",
        ),
        ...shimErrorResponses,
      },
    }),
  );

  app.openapi(createScheduled, async (c) => {
    requireLegacyTaskScheduleShim("POST /v1/tasks/schedules");
    logLegacyTaskScheduleShimHit(c, "POST /v1/tasks/scheduled");
    const input = mapLegacyCreateToTaskSchedule(c.req.valid("json"));
    const schedule = await createTaskSchedule(c.var, input);
    return created(c, mapTaskScheduleToLegacyProjection(schedule));
  });

  const putSchedule = withCoworkerContextHeaderParameters(
    createRoute({
      method: "put",
      path: "/{id}/schedule",
      deprecated: true,
      description: `Create or update a Task Schedule from the old PUT /tasks/{id}/schedule body. ${SHIM_UNTIL}`,
      tags: ["Tasks"],
      request: {
        params: taskParams,
        body: {
          content: {
            "application/json": { schema: legacyPutTaskScheduleRequestSchema },
          },
        },
      },
      responses: {
        200: jsonSuccessResponse(
          legacyTaskScheduleProjectionSchema,
          "Legacy schedule projection",
        ),
        ...shimErrorResponses,
      },
    }),
  );

  app.openapi(putSchedule, async (c) => {
    requireLegacyTaskScheduleShim("POST /v1/tasks/schedules");
    logLegacyTaskScheduleShimHit(c, "PUT /v1/tasks/{id}/schedule");
    const taskId = c.req.valid("param").id;
    const scheduleInput = parseLegacyPutScheduleBody(c.req.valid("json"));
    const existingId = await resolveTaskScheduleId(taskId);

    if (existingId) {
      const current = await getTaskSchedule(c.var, existingId);
      const schedule = await updateTaskSchedule(
        c.var,
        existingId,
        mapLegacyPutScheduleToUpdate(scheduleInput, current.revision),
      );
      return ok(c, mapTaskScheduleToLegacyProjection(schedule));
    }

    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const task = await findTaskBlueprint(taskId);
    if (!task || task.workspaceId !== workspace.workspaceId) {
      throw notFound("Task not found");
    }
    const createdSchedule = await createTaskSchedule(
      c.var,
      mapTaskBlueprintToCreate(task, scheduleInput),
      { id: shimCreatedTaskScheduleId(taskId) },
    );
    return ok(c, mapTaskScheduleToLegacyProjection(createdSchedule));
  });

  const getSchedule = withCoworkerContextHeaderParameters(
    createRoute({
      method: "get",
      path: "/{id}/schedule",
      deprecated: true,
      description: `Read the Task Schedule linked to a Task (or the schedule id itself). ${SHIM_UNTIL}`,
      tags: ["Tasks"],
      request: { params: taskParams },
      responses: {
        200: jsonSuccessResponse(
          legacyTaskScheduleProjectionSchema,
          "Legacy schedule projection",
        ),
        401: jsonErrorResponse("Unauthorized"),
        403: jsonErrorResponse("Forbidden"),
        404: jsonErrorResponse("Not Found"),
        ...goneResponses,
      },
    }),
  );

  app.openapi(getSchedule, async (c) => {
    requireLegacyTaskScheduleShim("GET /v1/tasks/schedules/{id}");
    logLegacyTaskScheduleShimHit(c, "GET /v1/tasks/{id}/schedule");
    const scheduleId = await requireResolvedTaskScheduleId(
      c.req.valid("param").id,
    );
    const schedule = await getTaskSchedule(c.var, scheduleId);
    return ok(c, mapTaskScheduleToLegacyProjection(schedule));
  });

  const deleteSchedule = withCoworkerContextHeaderParameters(
    createRoute({
      method: "delete",
      path: "/{id}/schedule",
      deprecated: true,
      description: `Delete the Task Schedule linked to a Task. ${SHIM_UNTIL}`,
      tags: ["Tasks"],
      request: { params: taskParams },
      responses: {
        204: { description: "Task Schedule deleted" },
        401: jsonErrorResponse("Unauthorized"),
        403: jsonErrorResponse("Forbidden"),
        404: jsonErrorResponse("Not Found"),
        409: jsonErrorResponse("Conflict"),
        ...goneResponses,
      },
    }),
  );

  app.openapi(deleteSchedule, async (c) => {
    requireLegacyTaskScheduleShim("DELETE /v1/tasks/schedules/{id}");
    logLegacyTaskScheduleShimHit(c, "DELETE /v1/tasks/{id}/schedule");
    const scheduleId = await requireResolvedTaskScheduleId(
      c.req.valid("param").id,
    );
    await deleteTaskSchedule(c.var, scheduleId);
    return empty(c);
  });

  const putCalendarSchedule = withCoworkerContextHeaderParameters(
    createRoute({
      method: "put",
      path: "/{id}/calendar-schedule",
      deprecated: true,
      description: `Replace a Task Schedule rule from the old Calendar envelope. ${SHIM_UNTIL}`,
      tags: ["Tasks"],
      request: {
        params: taskParams,
        body: {
          content: {
            "application/json": {
              schema: legacyPutCalendarTaskScheduleRequestSchema,
            },
          },
        },
      },
      responses: {
        200: jsonSuccessResponse(
          legacyTaskScheduleProjectionSchema,
          "Legacy schedule projection",
        ),
        ...shimErrorResponses,
      },
    }),
  );

  app.openapi(putCalendarSchedule, async (c) => {
    requireLegacyTaskScheduleShim("PATCH /v1/tasks/schedules/{id}");
    logLegacyTaskScheduleShimHit(c, "PUT /v1/tasks/{id}/calendar-schedule");
    const update = mapLegacyCalendarScheduleToUpdate(
      parseLegacyCalendarScheduleBody(c.req.valid("json")),
    );
    const scheduleId = await requireResolvedTaskScheduleId(
      c.req.valid("param").id,
    );
    const schedule = await updateTaskSchedule(c.var, scheduleId, update);
    return ok(c, mapTaskScheduleToLegacyProjection(schedule));
  });

  const putCalendarSource = withCoworkerContextHeaderParameters(
    createRoute({
      method: "put",
      path: "/{id}/calendar-source",
      deprecated: true,
      description: `Move a Task Schedule's project from the old Calendar source envelope. ${SHIM_UNTIL}`,
      tags: ["Tasks"],
      request: {
        params: taskParams,
        body: {
          content: {
            "application/json": {
              schema: legacyPutCalendarSourceRequestSchema,
            },
          },
        },
      },
      responses: {
        200: jsonSuccessResponse(
          legacyTaskScheduleProjectionSchema,
          "Legacy schedule projection",
        ),
        ...shimErrorResponses,
      },
    }),
  );

  app.openapi(putCalendarSource, async (c) => {
    requireLegacyTaskScheduleShim("PATCH /v1/tasks/schedules/{id}");
    logLegacyTaskScheduleShimHit(c, "PUT /v1/tasks/{id}/calendar-source");
    const update = mapLegacyCalendarSourceToUpdate(
      parseLegacyCalendarSourceBody(c.req.valid("json")),
    );
    const scheduleId = await requireResolvedTaskScheduleId(
      c.req.valid("param").id,
    );
    const schedule = await updateTaskSchedule(c.var, scheduleId, update);
    return ok(c, mapTaskScheduleToLegacyProjection(schedule));
  });

  for (const moved of OCCURRENCE_ROUTES) {
    const route = createRoute({
      method: moved.method,
      path: moved.path,
      deprecated: true,
      description: `Removed. Repeating rules are Task Schedules; use ${moved.replacement}. A one-time start is \`runAt\` on POST /v1/tasks or PATCH /v1/tasks/{id}.`,
      tags: ["Tasks"],
      request: { params: moved.params },
      responses: goneResponses,
    });

    app.openapi(route, () => {
      throwGone(moved.replacement);
    });
  }
}

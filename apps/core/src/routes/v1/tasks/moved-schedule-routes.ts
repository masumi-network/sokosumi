import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import {
  errorResponseWithExtensionsSchema,
  gone,
  notFound,
} from "@/helpers/error";
import {
  findTaskBlueprint,
  linkTaskToSchedule,
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
} from "@/helpers/legacy-task-schedule-shim";
import {
  jsonContent,
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import { created, ok } from "@/helpers/response";
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
  taskScheduleRunListQuerySchema,
  taskScheduleRunSchema,
} from "@/schemas/task-schedule.schema";
import {
  createTaskSchedule,
  getTaskSchedule,
  listTaskScheduleRuns,
  mapTaskScheduleRun,
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
  "Temporary adapter until EOD 2026-09-29 CEST (`LEGACY_TASK_SCHEDULE_SHIM`). Translates to `/v1/tasks/schedules`. A one-time start is `runAt` on POST /v1/tasks.";

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
 * Temporary: until EOD 2026-09-29 CEST, create / update / read translate
 * to Task Schedule. DELETE and occurrence skip/move/restore stay 410.
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
    logLegacyTaskScheduleShimHit(c, {
      method: "POST",
      path: "/v1/tasks/scheduled",
      mappedTarget: "POST /v1/tasks/schedules",
    });
    const input = mapLegacyCreateToTaskSchedule(c.req.valid("json"));
    const schedule = await createTaskSchedule(c.var, input);
    return created(c, mapTaskScheduleToLegacyProjection(schedule));
  });

  const putSchedule = withCoworkerContextHeaderParameters(
    createRoute({
      method: "put",
      path: "/{id}/schedule",
      deprecated: true,
      description: `Create or update a Task Schedule from the old PUT /tasks/{id}/schedule body (Serviceplan create path). ${SHIM_UNTIL}`,
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
    const taskId = c.req.valid("param").id;
    const scheduleInput = parseLegacyPutScheduleBody(c.req.valid("json"));
    const existingId = await resolveTaskScheduleId(taskId);

    if (existingId) {
      logLegacyTaskScheduleShimHit(c, {
        method: "PUT",
        path: "/v1/tasks/{id}/schedule",
        mappedTarget: "PATCH /v1/tasks/schedules/{id}",
      });
      const current = await getTaskSchedule(c.var, existingId);
      const schedule = await updateTaskSchedule(
        c.var,
        existingId,
        mapLegacyPutScheduleToUpdate(scheduleInput, current.revision),
      );
      return ok(c, mapTaskScheduleToLegacyProjection(schedule));
    }

    logLegacyTaskScheduleShimHit(c, {
      method: "PUT",
      path: "/v1/tasks/{id}/schedule",
      mappedTarget: "POST /v1/tasks/schedules",
    });
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const task = await findTaskBlueprint(taskId);
    if (!task || task.workspaceId !== workspace.workspaceId) {
      throw notFound("Task not found");
    }
    const createdSchedule = await createTaskSchedule(
      c.var,
      mapTaskBlueprintToCreate(task, scheduleInput),
    );
    await linkTaskToSchedule(taskId, createdSchedule.id);
    return ok(c, mapTaskScheduleToLegacyProjection(createdSchedule));
  });

  const getSchedule = withCoworkerContextHeaderParameters(
    createRoute({
      method: "get",
      path: "/{id}/schedule",
      deprecated: true,
      description: `Read the Task Schedule linked to a Task (or the schedule id itself). Old Task GET no longer carries metadata/nextRunAt/scheduleRevision; this is the shim read of the rule. ${SHIM_UNTIL}`,
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
    logLegacyTaskScheduleShimHit(c, {
      method: "GET",
      path: "/v1/tasks/{id}/schedule",
      mappedTarget: "GET /v1/tasks/schedules/{id}",
    });
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
      description:
        "Removed. Repeating rules are Task Schedules; use DELETE /v1/tasks/schedules/{id}.",
      tags: ["Tasks"],
      request: { params: taskParams },
      responses: goneResponses,
    }),
  );

  app.openapi(deleteSchedule, () => {
    throwGone("DELETE /v1/tasks/schedules/{id}");
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
    logLegacyTaskScheduleShimHit(c, {
      method: "PUT",
      path: "/v1/tasks/{id}/calendar-schedule",
      mappedTarget: "PATCH /v1/tasks/schedules/{id}",
    });
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
    logLegacyTaskScheduleShimHit(c, {
      method: "PUT",
      path: "/v1/tasks/{id}/calendar-source",
      mappedTarget: "PATCH /v1/tasks/schedules/{id}",
    });
    const update = mapLegacyCalendarSourceToUpdate(
      parseLegacyCalendarSourceBody(c.req.valid("json")),
    );
    const scheduleId = await requireResolvedTaskScheduleId(
      c.req.valid("param").id,
    );
    const schedule = await updateTaskSchedule(c.var, scheduleId, update);
    return ok(c, mapTaskScheduleToLegacyProjection(schedule));
  });

  const getOccurrences = withCoworkerContextHeaderParameters(
    createRoute({
      method: "get",
      path: "/{id}/schedule/occurrences",
      deprecated: true,
      description: `List Runs of the linked Task Schedule (old occurrence ledger). ${SHIM_UNTIL}`,
      tags: ["Tasks"],
      request: {
        params: taskParams,
        query: taskScheduleRunListQuerySchema,
      },
      responses: {
        200: jsonPaginatedSuccessResponse(
          z.array(taskScheduleRunSchema),
          "Runs of the linked Task Schedule",
        ),
        401: jsonErrorResponse("Unauthorized"),
        403: jsonErrorResponse("Forbidden"),
        404: jsonErrorResponse("Not Found"),
        ...goneResponses,
      },
    }),
  );

  app.openapi(getOccurrences, async (c) => {
    requireLegacyTaskScheduleShim("GET /v1/tasks/schedules/{id}/runs");
    logLegacyTaskScheduleShimHit(c, {
      method: "GET",
      path: "/v1/tasks/{id}/schedule/occurrences",
      mappedTarget: "GET /v1/tasks/schedules/{id}/runs",
    });
    const scheduleId = await requireResolvedTaskScheduleId(
      c.req.valid("param").id,
    );
    const { runs, pagination } = await listTaskScheduleRuns(
      c.var,
      scheduleId,
      c.req.valid("query"),
    );
    return ok(
      c,
      z.array(taskScheduleRunSchema).parse(runs.map(mapTaskScheduleRun)),
      pagination,
    );
  });

  const patchOccurrence = createRoute({
    method: "patch",
    path: "/{id}/schedule/occurrences/{occurrenceId}",
    deprecated: true,
    description:
      "Removed. Repeating rules are Task Schedules; use PATCH /v1/tasks/schedules/{id}/runs/{runId}.",
    tags: ["Tasks"],
    request: { params: occurrenceParams },
    responses: goneResponses,
  });

  app.openapi(patchOccurrence, () => {
    throwGone("PATCH /v1/tasks/schedules/{id}/runs/{runId}");
  });
}

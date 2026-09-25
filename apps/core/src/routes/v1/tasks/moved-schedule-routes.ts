import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { errorResponseWithExtensionsSchema, gone } from "@/helpers/error";
import {
  type LegacyTaskScheduleShimHit,
  legacyRuleMatches,
  legacyTaskScheduleShimValidationHook,
  logLegacyTaskScheduleShimHit,
  mapLegacyCalendarSourceToUpdate,
  mapLegacyCreateToTaskSchedule,
  mapLegacyRuleToUpdate,
  mapTaskBlueprintToCreate,
  mapTaskScheduleToLegacyProjection,
  requireLegacyTaskScheduleShim,
  requireRecurringSchedule,
  requireResolvedTaskScheduleId,
  requireTaskBlueprint,
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
  getWritableTaskSchedule,
  listTaskScheduleRuns,
  mapTaskScheduleRun,
  resolveScheduleActor,
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

const NEW_CREATE = "POST /v1/tasks/schedules";
const NEW_GET = "GET /v1/tasks/schedules/{id}";
const NEW_PATCH = "PATCH /v1/tasks/schedules/{id}";
const NEW_RUNS = "GET /v1/tasks/schedules/{id}/runs";

const HITS = {
  createScheduled: {
    method: "POST",
    path: "/v1/tasks/scheduled",
    mappedTarget: NEW_CREATE,
  },
  putSchedule: {
    method: "PUT",
    path: "/v1/tasks/{id}/schedule",
    mappedTarget: NEW_CREATE,
  },
  getSchedule: {
    method: "GET",
    path: "/v1/tasks/{id}/schedule",
    mappedTarget: NEW_GET,
  },
  putCalendarSchedule: {
    method: "PUT",
    path: "/v1/tasks/{id}/calendar-schedule",
    mappedTarget: NEW_PATCH,
  },
  putCalendarSource: {
    method: "PUT",
    path: "/v1/tasks/{id}/calendar-source",
    mappedTarget: NEW_PATCH,
  },
  getOccurrences: {
    method: "GET",
    path: "/v1/tasks/{id}/schedule/occurrences",
    mappedTarget: NEW_RUNS,
  },
} satisfies Record<string, LegacyTaskScheduleShimHit>;

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
          required: true,
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

  app.openapi(
    createScheduled,
    async (c) => {
      requireLegacyTaskScheduleShim(NEW_CREATE);
      logLegacyTaskScheduleShimHit(c.var, HITS.createScheduled);
      const input = mapLegacyCreateToTaskSchedule(c.req.valid("json"));
      const schedule = await createTaskSchedule(c.var, input);
      return created(c, mapTaskScheduleToLegacyProjection(schedule));
    },
    legacyTaskScheduleShimValidationHook(HITS.createScheduled),
  );

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
          required: true,
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

  app.openapi(
    putSchedule,
    async (c) => {
      requireLegacyTaskScheduleShim(NEW_CREATE);
      const taskId = c.req.valid("param").id;
      const scheduleInput = c.req.valid("json");
      const existingId = await resolveTaskScheduleId(c.var, taskId);
      logLegacyTaskScheduleShimHit(
        c.var,
        existingId
          ? { ...HITS.putSchedule, mappedTarget: NEW_PATCH }
          : HITS.putSchedule,
      );
      requireRecurringSchedule(scheduleInput);

      if (existingId) {
        const current = await getWritableTaskSchedule(c.var, existingId);
        if (legacyRuleMatches(current, scheduleInput)) {
          return ok(c, mapTaskScheduleToLegacyProjection(current));
        }
        const schedule = await updateTaskSchedule(
          c.var,
          existingId,
          mapLegacyRuleToUpdate(scheduleInput, current),
        );
        return ok(c, mapTaskScheduleToLegacyProjection(schedule));
      }

      const actor = await resolveScheduleActor(c.var);
      const task = await requireTaskBlueprint(actor, taskId);
      const createdSchedule = await createTaskSchedule(
        c.var,
        mapTaskBlueprintToCreate(task, scheduleInput),
      );
      return ok(c, mapTaskScheduleToLegacyProjection(createdSchedule));
    },
    legacyTaskScheduleShimValidationHook(HITS.putSchedule),
  );

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
    requireLegacyTaskScheduleShim(NEW_GET);
    logLegacyTaskScheduleShimHit(c.var, HITS.getSchedule);
    const scheduleId = await requireResolvedTaskScheduleId(
      c.var,
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
          required: true,
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

  app.openapi(
    putCalendarSchedule,
    async (c) => {
      requireLegacyTaskScheduleShim(NEW_PATCH);
      logLegacyTaskScheduleShimHit(c.var, HITS.putCalendarSchedule);
      const body = c.req.valid("json");
      const scheduleInput = body.schedule;
      requireRecurringSchedule(scheduleInput);
      const scheduleId = await requireResolvedTaskScheduleId(
        c.var,
        c.req.valid("param").id,
      );
      const current = await getTaskSchedule(c.var, scheduleId);
      const schedule = await updateTaskSchedule(
        c.var,
        scheduleId,
        mapLegacyRuleToUpdate(
          scheduleInput,
          current,
          body.expectedScheduleRevision,
        ),
      );
      return ok(c, mapTaskScheduleToLegacyProjection(schedule));
    },
    legacyTaskScheduleShimValidationHook(HITS.putCalendarSchedule),
  );

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
          required: true,
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

  app.openapi(
    putCalendarSource,
    async (c) => {
      requireLegacyTaskScheduleShim(NEW_PATCH);
      logLegacyTaskScheduleShimHit(c.var, HITS.putCalendarSource);
      const update = mapLegacyCalendarSourceToUpdate(c.req.valid("json"));
      const scheduleId = await requireResolvedTaskScheduleId(
        c.var,
        c.req.valid("param").id,
      );
      const schedule = await updateTaskSchedule(c.var, scheduleId, update);
      return ok(c, mapTaskScheduleToLegacyProjection(schedule));
    },
    legacyTaskScheduleShimValidationHook(HITS.putCalendarSource),
  );

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

  app.openapi(
    getOccurrences,
    async (c) => {
      requireLegacyTaskScheduleShim(NEW_RUNS);
      logLegacyTaskScheduleShimHit(c.var, HITS.getOccurrences);
      const scheduleId = await requireResolvedTaskScheduleId(
        c.var,
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
    },
    legacyTaskScheduleShimValidationHook(HITS.getOccurrences),
  );

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

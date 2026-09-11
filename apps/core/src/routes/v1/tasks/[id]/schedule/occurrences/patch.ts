import { createRoute, z } from "@hono/zod-openapi";
import {
  TaskScheduleEventKind,
  TaskScheduleOccurrenceState,
} from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { requireTaskCollaboration } from "@/helpers/access-control";
import { requireCalendarBetaAccess } from "@/helpers/calendar-beta-access";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { getCalendarSourceId } from "@/helpers/calendar-source";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  CALENDAR_OCCURRENCE_HORIZON_MS,
  findNextReleaseableOccurrence,
} from "@/helpers/task-schedule-occurrence-index";
import {
  createTaskScheduleRequestFingerprint,
  isTaskScheduleOperationReplay,
} from "@/helpers/task-schedule-operation";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import {
  rescheduleTaskScheduleOccurrenceRequestSchema,
  taskScheduleOccurrenceMutationSchema,
} from "@/schemas/task-schedule-occurrence.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
  occurrenceId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "occurrenceId", in: "path" },
      example: "33333333-3333-7333-8333-333333333333",
    }),
});

const route = createRoute({
  method: "patch",
  path: "/{id}/schedule/occurrences/{occurrenceId}",
  description:
    "Move one unreleased schedule occurrence to a new time. Idempotent per operationId and guarded by the observed schedule revision.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: rescheduleTaskScheduleOccurrenceRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      taskScheduleOccurrenceMutationSchema,
      "Schedule occurrence rescheduled",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireOwnerUserContext(authContext);
    await requireCalendarBetaAccess(userContext.userId, prisma);
    const { id, occurrenceId } = c.req.valid("param");
    const { operationId, expectedScheduleRevision, scheduledAt } =
      c.req.valid("json");
    const target = new Date(scheduledAt);
    const now = new Date();

    if (target <= now) {
      throw unprocessableEntity("scheduledAt must be in the future", {
        kind: CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_TARGET_INVALID,
      });
    }
    if (target.getTime() >= now.getTime() + CALENDAR_OCCURRENCE_HORIZON_MS) {
      throw unprocessableEntity(
        "scheduledAt must be inside the schedule projection horizon",
        { kind: CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_TARGET_INVALID },
      );
    }

    const requestFingerprint = createTaskScheduleRequestFingerprint({
      action: "reschedule_occurrence",
      taskId: id,
      occurrenceId,
      scheduledAt: target.toISOString(),
    });

    const existingTask = await requireTaskCollaboration(
      authContext,
      id,
      prisma,
    );

    const result = await serializableTransaction(async (tx) => {
      if (
        !(await lockCalendarScope(tx, existingTask.workspaceId, [
          existingTask.projectId,
        ])) ||
        !(await lockTaskRows(tx, [id]))
      ) {
        throw conflict("Task changed during occurrence reschedule");
      }

      const currentTask = await requireTaskCollaboration(authContext, id, tx);
      if (
        currentTask.workspaceId !== existingTask.workspaceId ||
        currentTask.projectId !== existingTask.projectId
      ) {
        throw conflict(
          "Task Calendar source changed during occurrence reschedule",
        );
      }

      // A retry replays before any state check: the first attempt already
      // applied this move and may have advanced the revision the caller saw.
      if (
        await isTaskScheduleOperationReplay(tx, {
          taskId: id,
          operationId,
          requestFingerprint,
        })
      ) {
        const replayed = await tx.taskScheduleOccurrence.findUniqueOrThrow({
          where: { id: occurrenceId },
          include: {
            releasedTask: {
              select: { id: true, name: true, status: true, archivedAt: true },
            },
          },
        });
        return {
          scheduleRevision: currentTask.scheduleRevision,
          occurrence: replayed,
        };
      }

      if (expectedScheduleRevision !== currentTask.scheduleRevision) {
        throw conflict(
          "The schedule series changed; reload the Task and retry with its current scheduleRevision",
          { kind: CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT },
        );
      }

      const occurrence = await tx.taskScheduleOccurrence.findFirst({
        where: { id: occurrenceId, seriesTaskId: id },
        include: {
          releasedTask: {
            select: { id: true, name: true, status: true, archivedAt: true },
          },
        },
      });
      if (!occurrence) {
        throw notFound("Schedule occurrence not found");
      }
      if (
        occurrence.state !== TaskScheduleOccurrenceState.PLANNED ||
        occurrence.releasedTaskId !== null ||
        occurrence.effectiveScheduledAt <= now
      ) {
        throw conflict(
          "Only a future unreleased occurrence can be rescheduled",
          { kind: CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_NOT_RESCHEDULABLE },
        );
      }

      if (occurrence.effectiveScheduledAt.getTime() === target.getTime()) {
        return { scheduleRevision: currentTask.scheduleRevision, occurrence };
      }

      const updatedOccurrence = await tx.taskScheduleOccurrence.update({
        where: { id: occurrence.id },
        data: { effectiveScheduledAt: target },
        include: {
          releasedTask: {
            select: { id: true, name: true, status: true, archivedAt: true },
          },
        },
      });

      const nextReleaseable = await findNextReleaseableOccurrence(tx, id, now);
      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          nextRunAt: nextReleaseable?.effectiveScheduledAt ?? null,
          scheduleRevision: { increment: 1 },
        },
      });

      await tx.taskEvent.create({
        data: {
          taskId: id,
          userId: userContext.userId,
          scheduleKind: TaskScheduleEventKind.OCCURRENCE_RESCHEDULED,
          scheduleOperationId: operationId,
          schedulePayload: {
            action: "reschedule_occurrence",
            requestFingerprint,
            occurrenceId,
            originalScheduledAt:
              occurrence.originalScheduledAt?.toISOString() ?? null,
            effectiveScheduledAt: target.toISOString(),
            scheduleRevision: updatedTask.scheduleRevision,
          },
        },
        select: { id: true },
      });

      return {
        scheduleRevision: updatedTask.scheduleRevision,
        occurrence: updatedOccurrence,
      };
    }, "Task schedule changed during occurrence reschedule");

    return ok(
      c,
      taskScheduleOccurrenceMutationSchema.parse({
        scheduleRevision: result.scheduleRevision,
        occurrence: {
          ...result.occurrence,
          sourceId: getCalendarSourceId(result.occurrence),
          isMissed:
            result.occurrence.state === TaskScheduleOccurrenceState.PLANNED &&
            result.occurrence.effectiveScheduledAt < now,
        },
      }),
    );
  });
}

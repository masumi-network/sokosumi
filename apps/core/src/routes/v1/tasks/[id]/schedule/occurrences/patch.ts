import { randomUUID } from "node:crypto";

import { createRoute, z } from "@hono/zod-openapi";
import {
  TaskScheduleEventKind,
  TaskScheduleOccurrenceState,
} from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  parseTaskScheduleMetadata,
} from "@sokosumi/utils";

import { requireTaskScheduleWriteAccess } from "@/helpers/access-control";
import { requireCalendarBetaAccess } from "@/helpers/calendar-beta-access";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import {
  lockCalendarScope,
  lockTaskRows,
  requireOpenCalendarProject,
} from "@/helpers/calendar-locks";
import { getCalendarSourceId } from "@/helpers/calendar-source";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { resolveTaskEventActorFields } from "@/helpers/task-event-actor";
import { notifyTaskCalendarAction } from "@/helpers/task-notifications";
import { buildTaskScheduleMetadataV2 } from "@/helpers/task-schedule";
import {
  CALENDAR_OCCURRENCE_HORIZON_MS,
  findNextReleaseableOccurrence,
  replaceTaskSchedulePlannedOccurrences,
} from "@/helpers/task-schedule-occurrence-index";
import {
  createTaskScheduleRequestFingerprint,
  readTaskScheduleOperationReplay,
} from "@/helpers/task-schedule-operation";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { resolveUserContext } from "@/middleware/auth";
import {
  mutateTaskScheduleOccurrenceRequestSchema,
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

function buildOneTimeScheduleMutation(
  metadataJson: string | null,
  scheduleVersion: number,
  target: Date,
  changedAt: Date,
) {
  const current = parseTaskScheduleMetadata(metadataJson);
  if (current?.mode !== "once") {
    return null;
  }

  const metadata =
    current.version === 2
      ? { ...current, effectiveRunAt: target.toISOString() }
      : {
          ...buildTaskScheduleMetadataV2(
            { mode: "once", runAt: current.runAt },
            changedAt,
            randomUUID(),
          ),
          effectiveRunAt: target.toISOString(),
        };
  const upgradeOccurrence = current.version === 1 || scheduleVersion === 1;

  return {
    metadata,
    occurrenceData: {
      effectiveScheduledAt: target,
      ruleSnapshot: metadata,
      ...(upgradeOccurrence
        ? {
            scheduleVersion: 2,
            epochId: metadata.epochId,
            timezone: metadata.timezone,
          }
        : {}),
    },
  };
}

const route = createRoute({
  method: "patch",
  path: "/{id}/schedule/occurrences/{occurrenceId}",
  description:
    "Reschedule, skip, or restore one unreleased schedule occurrence. Idempotent per operationId and guarded by the observed schedule revision.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: mutateTaskScheduleOccurrenceRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      taskScheduleOccurrenceMutationSchema,
      "Schedule occurrence mutated",
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
    const actorFields = resolveTaskEventActorFields(authContext);
    const userContext = resolveUserContext(authContext);
    if (userContext) {
      await requireCalendarBetaAccess(userContext.userId, prisma);
    }
    const { id, occurrenceId } = c.req.valid("param");
    const mutation = c.req.valid("json");
    const { operationId, expectedScheduleRevision, action } = mutation;
    const now = new Date();
    const requestedScheduledAt =
      action === "reschedule"
        ? new Date(mutation.scheduledAt)
        : action === "restore" && mutation.scheduledAt
          ? new Date(mutation.scheduledAt)
          : null;

    const requestFingerprint = createTaskScheduleRequestFingerprint({
      action: `${action}_occurrence`,
      taskId: id,
      occurrenceId,
      scheduledAt: requestedScheduledAt?.toISOString() ?? null,
    });

    const existingTask = await requireTaskScheduleWriteAccess(
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
        throw conflict("Task changed during occurrence mutation");
      }

      const currentTask = await requireTaskScheduleWriteAccess(
        authContext,
        id,
        tx,
      );
      if (
        currentTask.workspaceId !== existingTask.workspaceId ||
        currentTask.projectId !== existingTask.projectId
      ) {
        throw conflict(
          "Task Calendar source changed during occurrence mutation",
        );
      }

      // A retry replays before any state check: the first attempt already
      // applied this mutation and may have advanced the revision the caller saw.
      const replayPayload = await readTaskScheduleOperationReplay(tx, {
        taskId: id,
        operationId,
        requestFingerprint,
      });
      if (replayPayload) {
        const storedResponse = taskScheduleOccurrenceMutationSchema.safeParse(
          replayPayload.payload.response,
        );
        if (storedResponse.success) {
          return {
            response: storedResponse.data,
            notification: {
              eventId: replayPayload.eventId,
              actorUserId: replayPayload.actorUserId,
              ownerId: currentTask.ownerId,
              taskName: currentTask.name,
            },
          };
        }

        // Reschedule operations created before response snapshots were added
        // still replay safely by reading the row without repeating effects.
        const replayed = await tx.taskScheduleOccurrence.findUniqueOrThrow({
          where: { id: occurrenceId },
          include: {
            releasedTask: {
              select: { id: true, name: true, status: true, archivedAt: true },
            },
          },
        });
        return {
          response: taskScheduleOccurrenceMutationSchema.parse({
            scheduleRevision: currentTask.scheduleRevision,
            occurrence: {
              ...replayed,
              sourceId: getCalendarSourceId(replayed),
              isMissed:
                replayed.state === TaskScheduleOccurrenceState.PLANNED &&
                replayed.effectiveScheduledAt < now,
            },
          }),
          notification: {
            eventId: replayPayload.eventId,
            actorUserId: replayPayload.actorUserId,
            ownerId: currentTask.ownerId,
            taskName: currentTask.name,
          },
        };
      }

      await requireOpenCalendarProject(
        tx,
        currentTask.workspaceId,
        currentTask.projectId,
      );

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
      const scheduleMetadata = parseTaskScheduleMetadata(currentTask.metadata);
      if (
        scheduleMetadata?.version === 1 &&
        scheduleMetadata.mode === "recurring"
      ) {
        throw conflict("Legacy recurring occurrences cannot be mutated", {
          kind:
            action === "reschedule"
              ? CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_NOT_RESCHEDULABLE
              : CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_STATE_CONFLICT,
        });
      }

      const expectedState =
        action === "restore"
          ? TaskScheduleOccurrenceState.SKIPPED
          : TaskScheduleOccurrenceState.PLANNED;
      if (
        occurrence.state !== expectedState ||
        occurrence.releasedTaskId !== null ||
        occurrence.effectiveScheduledAt <= now
      ) {
        throw conflict(
          `This occurrence cannot be changed with ${action} from its current state`,
          {
            kind:
              action === "reschedule"
                ? CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_NOT_RESCHEDULABLE
                : CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_STATE_CONFLICT,
          },
        );
      }

      const target =
        action === "skip"
          ? occurrence.effectiveScheduledAt
          : (requestedScheduledAt ?? occurrence.originalScheduledAt);
      if (!target || target <= now) {
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

      if (
        action === "reschedule" &&
        occurrence.effectiveScheduledAt.getTime() === target.getTime()
      ) {
        return {
          response: {
            scheduleRevision: currentTask.scheduleRevision,
            occurrence,
          },
          notification: null,
        };
      }

      const oneTimeMutation = buildOneTimeScheduleMutation(
        currentTask.metadata,
        occurrence.scheduleVersion,
        target,
        now,
      );
      const updatedOccurrence = await tx.taskScheduleOccurrence.update({
        where: { id: occurrence.id },
        data: {
          ...(oneTimeMutation?.occurrenceData ?? {
            effectiveScheduledAt: target,
          }),
          ...(action === "skip"
            ? { state: TaskScheduleOccurrenceState.SKIPPED }
            : action === "restore"
              ? { state: TaskScheduleOccurrenceState.PLANNED }
              : {}),
          actorUserId: actorFields.userId,
        },
        include: {
          releasedTask: {
            select: { id: true, name: true, status: true, archivedAt: true },
          },
        },
      });

      const activeEpochId =
        oneTimeMutation?.metadata.epochId ??
        (scheduleMetadata?.version === 2 ? scheduleMetadata.epochId : null);
      if (
        scheduleMetadata?.version === 2 &&
        scheduleMetadata.mode === "recurring" &&
        scheduleMetadata.endsMode === "after" &&
        currentTask.nextRunAt
      ) {
        const indexTask = {
          id,
          workspaceId: currentTask.workspaceId,
          projectId: currentTask.projectId,
          schedule: scheduleMetadata,
          nextRunAt: currentTask.nextRunAt,
        };
        if (action === "skip" || action === "restore") {
          await replaceTaskSchedulePlannedOccurrences(tx, indexTask, now);
        }
      }
      const nextReleaseable = await findNextReleaseableOccurrence(
        tx,
        id,
        activeEpochId,
      );
      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          ...(oneTimeMutation
            ? { metadata: JSON.stringify(oneTimeMutation.metadata) }
            : {}),
          nextRunAt: nextReleaseable?.effectiveScheduledAt ?? null,
          scheduleRevision: { increment: 1 },
        },
      });

      const response = taskScheduleOccurrenceMutationSchema.parse({
        scheduleRevision: updatedTask.scheduleRevision,
        occurrence: {
          ...updatedOccurrence,
          sourceId: getCalendarSourceId(updatedOccurrence),
          isMissed:
            updatedOccurrence.state === TaskScheduleOccurrenceState.PLANNED &&
            updatedOccurrence.effectiveScheduledAt < now,
        },
      });

      const event = await tx.taskEvent.create({
        data: {
          taskId: id,
          ...actorFields,
          scheduleKind:
            action === "skip"
              ? TaskScheduleEventKind.OCCURRENCE_SKIPPED
              : action === "restore"
                ? TaskScheduleEventKind.OCCURRENCE_RESTORED
                : TaskScheduleEventKind.OCCURRENCE_RESCHEDULED,
          scheduleOperationId: operationId,
          schedulePayload: {
            action: `${action}_occurrence`,
            requestFingerprint,
            occurrenceId,
            originalScheduledAt:
              occurrence.originalScheduledAt?.toISOString() ?? null,
            effectiveScheduledAt: target.toISOString(),
            scheduleRevision: updatedTask.scheduleRevision,
            response,
          },
        },
        select: { id: true },
      });

      return {
        response,
        notification: {
          eventId: event.id,
          actorUserId: userContext?.userId ?? null,
          ownerId: currentTask.ownerId,
          taskName: currentTask.name,
        },
      };
    }, "Task schedule changed during occurrence mutation");

    await Promise.all([
      result.notification
        ? notifyTaskCalendarAction({
            taskId: id,
            taskName: result.notification.taskName,
            ownerId: result.notification.ownerId,
            actorUserId: result.notification.actorUserId,
            eventId: result.notification.eventId,
            messageKey: "Notifications.Task.scheduleOccurrenceChangedByMember",
            action: `${action}_occurrence`,
          })
        : Promise.resolve(),
      deliverCalendarInvalidationsNow(existingTask.workspaceId),
    ]);

    return ok(c, result.response);
  });
}

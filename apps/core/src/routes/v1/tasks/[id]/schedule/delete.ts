import { createRoute, z } from "@hono/zod-openapi";
import { TaskScheduleEventKind, TaskStatus } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS, hasActiveTaskSchedule } from "@sokosumi/utils";

import { requireTaskScheduleWriteAccess } from "@/helpers/access-control";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import {
  lockCalendarScope,
  lockTaskRows,
  requireOpenCalendarProject,
} from "@/helpers/calendar-locks";
import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import { resolveTaskEventActorFields } from "@/helpers/task-event-actor";
import { notifyTaskCalendarAction } from "@/helpers/task-notifications";
import { isSchedulableTaskStatus } from "@/helpers/task-schedule";
import { retireTaskScheduleFutureOccurrences } from "@/helpers/task-schedule-occurrence-index";
import {
  createTaskScheduleRequestFingerprint,
  readTaskScheduleOperationReplay,
} from "@/helpers/task-schedule-operation";
import { getTaskScheduleQuarantineAuditSnapshot } from "@/helpers/task-schedule-quarantine";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { resolveUserContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import { buildTaskIncludeForViewer } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const SCHEDULE_REVISION_HEADER_PATTERN = /^(0|[1-9]\d*)$/;

// Hono lower-cases request header names before validation, and zod-to-openapi
// documents each parameter under its schema key, so these keys are the
// canonical request headers in their matched-case form.
const headersSchema = z.object({
  "idempotency-key": z
    .string()
    .uuid()
    .openapi({
      param: { in: "header" },
      description: "Idempotency identity for this series removal",
      example: "123e4567-e89b-42d3-a456-426614174000",
    }),
  "x-sokosumi-schedule-revision": z
    .string()
    .regex(
      SCHEDULE_REVISION_HEADER_PATTERN,
      "X-Sokosumi-Schedule-Revision must be a non-negative integer",
    )
    .openapi({
      param: { in: "header" },
      description: "Schedule revision observed by the caller",
      example: "3",
    }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}/schedule",
  description:
    "Remove a Calendar schedule series. Idempotent per Idempotency-Key and guarded by the observed schedule revision.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    headers: headersSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Task schedule removed"),
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
    const userContext = resolveUserContext(authContext);
    // Removal requires Task collaboration, but deliberately not Calendar beta
    // access: it is the escape hatch for every schedule, including the ones the
    // un-gated legacy route still creates.
    const { id } = c.req.valid("param");
    const {
      "idempotency-key": operationId,
      "x-sokosumi-schedule-revision": scheduleRevision,
    } = c.req.valid("header");
    const expectedScheduleRevision = Number(scheduleRevision);
    // Removal has one possible outcome per Task, so its identity is the whole
    // request; reusing the key for an edit hashes differently and conflicts.
    const requestFingerprint = createTaskScheduleRequestFingerprint({
      action: "remove_schedule",
      taskId: id,
    });

    const existingTask = await requireTaskScheduleWriteAccess(
      authContext,
      id,
      prisma,
    );

    const result = await serializableTransaction(async (tx) => {
      const scopeLocked = await lockCalendarScope(
        tx,
        existingTask.workspaceId,
        [existingTask.projectId],
        userContext?.userId,
      );
      if (!scopeLocked || !(await lockTaskRows(tx, [id]))) {
        throw conflict("Task changed during schedule removal");
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
        throw conflict("Task Calendar source changed during schedule removal");
      }

      // A retry replays before any state check: the first attempt already
      // cleared the series and advanced the revision the caller observed.
      const replay = await readTaskScheduleOperationReplay(tx, {
        taskId: id,
        operationId,
        requestFingerprint,
      });
      if (replay) {
        const task = await tx.task.findUniqueOrThrow({
          where: { id },
          include: buildTaskIncludeForViewer(
            authContext,
            currentTask.workspaceId,
          ),
        });
        return {
          task,
          notification: {
            eventId: replay.eventId,
            actorUserId: replay.actorUserId,
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
      // Quarantine is reported ahead of the revision so a caller holding a
      // stale revision is not sent to reload and retry into a 409 it cannot
      // resolve by reloading.
      const quarantine = await tx.taskScheduleQuarantine.findUnique({
        where: { taskId: id },
      });
      // Human schedules were accepted by mistake. Collaborators can remove
      // these through the usual audited, revision-guarded escape hatch.
      if (quarantine && !currentTask.assigneeUserId) {
        throw conflict(
          "This schedule is quarantined and requires audited operator removal",
          { kind: CORE_API_ERROR_KINDS.SCHEDULE_QUARANTINED },
        );
      }
      if (
        !quarantine &&
        !hasActiveTaskSchedule(currentTask.metadata, currentTask.nextRunAt)
      ) {
        throw conflict("Task does not have an active schedule series");
      }
      if (expectedScheduleRevision !== currentTask.scheduleRevision) {
        throw conflict(
          "The schedule series changed; reload the Task and retry with its current scheduleRevision",
          { kind: CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT },
        );
      }

      const task = await tx.task.update({
        where: { id },
        data: {
          metadata: null,
          nextRunAt: null,
          scheduleRevision: { increment: 1 },
          // Without its rule the template is no longer runnable work.
          ...(isSchedulableTaskStatus(currentTask.status)
            ? { status: TaskStatus.DRAFT }
            : {}),
        },
        include: buildTaskIncludeForViewer(
          authContext,
          currentTask.workspaceId,
        ),
      });
      if (quarantine) {
        await tx.taskScheduleQuarantine.delete({ where: { taskId: id } });
      }
      const retired = await retireTaskScheduleFutureOccurrences(
        tx,
        id,
        new Date(),
      );
      const event = await tx.taskEvent.create({
        data: {
          taskId: id,
          ...resolveTaskEventActorFields(authContext),
          scheduleKind: TaskScheduleEventKind.REMOVED,
          scheduleOperationId: operationId,
          schedulePayload: {
            action: "remove_schedule",
            requestFingerprint,
            workspaceId: currentTask.workspaceId,
            projectId: currentTask.projectId,
            scheduleRevision: task.scheduleRevision,
            canceledFutureExceptionCount: retired.canceledCount,
            ...(quarantine
              ? getTaskScheduleQuarantineAuditSnapshot(quarantine)
              : {}),
          },
        },
        select: { id: true },
      });
      return {
        task,
        notification: {
          eventId: event.id,
          actorUserId: userContext?.userId ?? null,
          ownerId: currentTask.ownerId,
          taskName: currentTask.name,
        },
      };
    }, "Task schedule changed during schedule removal");

    await Promise.all([
      notifyTaskCalendarAction({
        taskId: id,
        taskName: result.notification.taskName,
        ownerId: result.notification.ownerId,
        actorUserId: result.notification.actorUserId,
        eventId: result.notification.eventId,
        messageKey: "Notifications.Task.scheduleRemovedByMember",
        action: "remove_schedule",
      }),
      deliverCalendarInvalidationsNow(existingTask.workspaceId),
    ]);

    return ok(c, taskSchema.parse(mapTask(result.task, authContext)));
  });
}

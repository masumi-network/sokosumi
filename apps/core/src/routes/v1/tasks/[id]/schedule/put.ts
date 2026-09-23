import { randomUUID } from "node:crypto";

import { createRoute, z } from "@hono/zod-openapi";
import { TaskScheduleEventKind, TaskStatus } from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  parseTaskScheduleMetadata,
} from "@sokosumi/utils";

import { requireTaskScheduleWriteAccess } from "@/helpers/access-control";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import {
  lockCalendarScope,
  lockTaskRows,
  requireOpenCalendarProject,
} from "@/helpers/calendar-locks";
import { badRequest, conflict, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { ok } from "@/helpers/response";
import { mapTask, validateTaskAssigneeAssignment } from "@/helpers/task";
import { resolveTaskEventActorFields } from "@/helpers/task-event-actor";
import { notifyTaskCalendarAction } from "@/helpers/task-notifications";
import {
  buildTaskScheduleMetadata,
  buildUpdatedTaskScheduleMetadataV2,
  computeScheduleNextRun,
  isSchedulableTaskStatus,
  validateScheduleInput,
} from "@/helpers/task-schedule";
import {
  createTaskSchedulePlannedOccurrences,
  replaceTaskSchedulePlannedOccurrences,
  retireTaskScheduleFutureOccurrences,
  TaskScheduleOccurrenceLimitError,
} from "@/helpers/task-schedule-occurrence-index";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { resolveUserContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import { putTaskScheduleRequestSchema } from "@/schemas/task-schedule.schema";
import { buildTaskIncludeForViewer } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "put",
  path: "/{id}/schedule",
  description: "Create or update a task schedule",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: putTaskScheduleRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Task schedule saved"),
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
    const userContext = resolveUserContext(authContext);
    const { id } = c.req.valid("param");
    const schedule = c.req.valid("json");

    validateScheduleInput(schedule);

    const scheduledAt = new Date();
    const existingTask = await requireTaskScheduleWriteAccess(
      authContext,
      id,
      prisma,
    );

    const result = await prisma
      .$transaction(async (tx) => {
        const locked = await lockCalendarScope(
          tx,
          existingTask.workspaceId,
          [existingTask.projectId],
          userContext?.userId,
        );
        if (!locked) {
          throw conflict("Task Calendar source changed during schedule update");
        }
        if (!(await lockTaskRows(tx, [id]))) {
          throw conflict("Task changed during schedule update");
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
          throw conflict("Task Calendar source changed during schedule update");
        }
        await requireOpenCalendarProject(
          tx,
          currentTask.workspaceId,
          currentTask.projectId,
        );
        if (!isSchedulableTaskStatus(currentTask.status)) {
          throw forbidden(
            "You can only schedule draft, ready, or queued tasks",
          );
        }
        if (userContext) {
          await requireAssignedOrganizationSeat(
            userContext.userId,
            currentTask.organizationId,
            tx,
          );
        }
        const quarantine = await tx.taskScheduleQuarantine.findUnique({
          where: { taskId: id },
          select: { id: true },
        });
        if (quarantine) {
          throw conflict(
            "This schedule is quarantined and requires operator repair",
            { kind: CORE_API_ERROR_KINDS.SCHEDULE_QUARANTINED },
          );
        }

        validateTaskAssigneeAssignment({
          status: currentTask.assigneeUserId
            ? TaskStatus.READY
            : TaskStatus.QUEUED,
          assigneeId: currentTask.assigneeId,
          assigneeSokoBotId: currentTask.assigneeSokoBotId,
          assigneeUserId: currentTask.assigneeUserId,
        });

        const persistedMetadata = parseTaskScheduleMetadata(
          currentTask.metadata,
        );
        const metadata =
          persistedMetadata?.version === 2
            ? buildUpdatedTaskScheduleMetadataV2(
                schedule,
                persistedMetadata,
                scheduledAt,
                randomUUID(),
              )
            : buildTaskScheduleMetadata(schedule, scheduledAt);
        const nextRunAt =
          persistedMetadata?.version === 2 &&
          metadata === persistedMetadata &&
          currentTask.nextRunAt
            ? currentTask.nextRunAt
            : computeScheduleNextRun(metadata);
        if (!nextRunAt) {
          throw badRequest("Unable to compute the next scheduled run");
        }

        const task = await tx.task.update({
          where: { id },
          data: {
            metadata: JSON.stringify(metadata),
            nextRunAt,
            // Legacy contract keeps its bare body, but every rule write still
            // advances the concurrency token Calendar clients observe.
            scheduleRevision: { increment: 1 },
            ...(currentTask.status !==
            (currentTask.assigneeUserId ? TaskStatus.READY : TaskStatus.QUEUED)
              ? {
                  status: currentTask.assigneeUserId
                    ? TaskStatus.READY
                    : TaskStatus.QUEUED,
                }
              : {}),
          },
          include: buildTaskIncludeForViewer(
            authContext,
            currentTask.workspaceId,
          ),
        });
        const indexTask = {
          id,
          workspaceId: currentTask.workspaceId,
          projectId: currentTask.projectId,
          schedule: metadata,
          nextRunAt,
        };
        if (
          persistedMetadata?.version === 2 &&
          metadata.version === 2 &&
          metadata.epochId !== persistedMetadata.epochId
        ) {
          // Same pair as PUT /calendar-schedule: future exceptions belong to
          // the epoch that defined them, so the old epoch's future half is
          // retired before the new epoch is projected.
          await retireTaskScheduleFutureOccurrences(tx, id, scheduledAt);
          await createTaskSchedulePlannedOccurrences(
            tx,
            indexTask,
            scheduledAt,
          );
        } else {
          await replaceTaskSchedulePlannedOccurrences(tx, indexTask);
        }
        const event = await tx.taskEvent.create({
          data: {
            taskId: id,
            ...resolveTaskEventActorFields(authContext),
            scheduleKind: persistedMetadata
              ? TaskScheduleEventKind.UPDATED
              : TaskScheduleEventKind.CREATED,
            schedulePayload: {
              action: "save_schedule",
              workspaceId: currentTask.workspaceId,
              projectId: currentTask.projectId,
              scheduleRevision: task.scheduleRevision,
            },
          },
          select: { id: true },
        });
        return {
          task,
          notification: {
            actorUserId: userContext?.userId ?? null,
            eventId: event.id,
            ownerId: task.ownerId,
            taskName: task.name ?? "Untitled task",
          },
        };
      })
      .catch((error: unknown) => {
        if (error instanceof TaskScheduleOccurrenceLimitError) {
          throw badRequest(error.message);
        }
        throw error;
      });

    await Promise.all([
      notifyTaskCalendarAction({
        taskId: id,
        taskName: result.notification.taskName,
        ownerId: result.notification.ownerId,
        actorUserId: result.notification.actorUserId,
        eventId: result.notification.eventId,
        messageKey: "Notifications.Task.scheduleUpdatedByMember",
        action: "save_schedule",
      }),
      deliverCalendarInvalidationsNow(existingTask.workspaceId),
    ]);

    return ok(c, taskSchema.parse(mapTask(result.task, authContext)));
  });
}

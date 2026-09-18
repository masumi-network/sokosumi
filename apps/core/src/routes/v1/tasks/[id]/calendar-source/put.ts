import { randomUUID } from "node:crypto";

import { createRoute, z } from "@hono/zod-openapi";
import { TaskScheduleEventKind, TaskStatus } from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  parseTaskScheduleMetadata,
} from "@sokosumi/utils";

import { requireTaskScheduleWriteAccess } from "@/helpers/access-control";
import { requireCalendarBetaAccess } from "@/helpers/calendar-beta-access";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { badRequest, conflict, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { ok } from "@/helpers/response";
import { validateTaskAssigneeAssignment } from "@/helpers/task";
import { resolveTaskEventActorFields } from "@/helpers/task-event-actor";
import { notifyTaskCalendarAction } from "@/helpers/task-notifications";
import {
  computeScheduleNextRun,
  isDueRunPastScheduleEnd,
  isSchedulableTaskStatus,
  rebuildTaskScheduleMetadataV2ForNewEpoch,
} from "@/helpers/task-schedule";
import {
  createTaskSchedulePlannedOccurrences,
  retireTaskScheduleFutureOccurrences,
  TaskScheduleOccurrenceLimitError,
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
  type CalendarTaskScheduleSource,
  putCalendarTaskScheduleSourceRequestSchema,
  taskScheduleSourceMutationSchema,
} from "@/schemas/task-schedule.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

function sourceFromProjectId(
  projectId: string | null,
): CalendarTaskScheduleSource {
  return projectId ? { type: "project", projectId } : { type: "workspace" };
}

const route = createRoute({
  method: "put",
  path: "/{id}/calendar-source",
  description:
    "Move an active Calendar schedule series between its Workspace and an open Project in that Workspace.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: putCalendarTaskScheduleSourceRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      taskScheduleSourceMutationSchema,
      "Calendar source moved",
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
    const userContext = resolveUserContext(authContext);
    if (userContext) {
      await requireCalendarBetaAccess(userContext.userId, prisma);
    }
    const { id } = c.req.valid("param");
    const {
      operationId,
      expectedScheduleRevision,
      discardFutureExceptions,
      source,
    } = c.req.valid("json");
    const targetProjectId = source.type === "project" ? source.projectId : null;
    const requestFingerprint = createTaskScheduleRequestFingerprint({
      action: "move_source",
      taskId: id,
      discardFutureExceptions,
      source,
    });

    const existingTask = await requireTaskScheduleWriteAccess(
      authContext,
      id,
      prisma,
    );

    const response = await serializableTransaction(async (tx) => {
      if (
        !(await lockCalendarScope(
          tx,
          existingTask.workspaceId,
          [existingTask.projectId, targetProjectId],
          userContext?.userId,
        )) ||
        !(await lockTaskRows(tx, [id]))
      ) {
        throw conflict("Task Calendar source changed during source move");
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
        throw conflict("Task Calendar source changed during source move");
      }

      // The first attempt may already have changed both the source and the
      // revision. Replaying its stored response must precede those checks.
      const replayPayload = await readTaskScheduleOperationReplay(tx, {
        taskId: id,
        operationId,
        requestFingerprint,
      });
      if (replayPayload) {
        const storedResponse = taskScheduleSourceMutationSchema.safeParse(
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
        throw conflict("The original Calendar source move cannot be replayed", {
          kind: CORE_API_ERROR_KINDS.IDEMPOTENCY_CONFLICT,
        });
      }

      if (expectedScheduleRevision !== currentTask.scheduleRevision) {
        throw conflict(
          "The schedule series changed; reload the Task and retry with its current scheduleRevision",
          { kind: CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT },
        );
      }
      if (currentTask.projectId === targetProjectId) {
        throw conflict("Task already uses this Calendar source");
      }
      if (!isSchedulableTaskStatus(currentTask.status)) {
        throw forbidden("You can only move draft, ready, or queued schedules");
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

      const projectIds = [currentTask.projectId, targetProjectId].filter(
        (projectId): projectId is string => projectId !== null,
      );
      if (projectIds.length > 0) {
        const projects = await tx.project.findMany({
          where: {
            id: { in: [...new Set(projectIds)] },
            workspaceId: currentTask.workspaceId,
          },
          select: { id: true, closingAt: true, closedAt: true },
        });
        if (projects.length !== new Set(projectIds).size) {
          throw notFound("Project not found");
        }
        if (projects.some((project) => project.closingAt || project.closedAt)) {
          throw conflict(
            "Cannot move a Calendar series into or out of a closing or closed Project",
          );
        }
      }

      const currentMetadata = parseTaskScheduleMetadata(currentTask.metadata);
      if (!currentMetadata || !currentTask.nextRunAt) {
        throw conflict("Task does not have a valid active Calendar schedule");
      }

      const changedAt = new Date();
      const metadata = rebuildTaskScheduleMetadataV2ForNewEpoch(
        currentMetadata,
        changedAt,
        randomUUID(),
      );
      const nextRunAt = computeScheduleNextRun(metadata);
      if (!nextRunAt) {
        throw badRequest("Unable to compute the next scheduled run");
      }
      const hasFutureRuleOccurrence =
        metadata.mode === "once"
          ? nextRunAt > changedAt
          : !isDueRunPastScheduleEnd(metadata, nextRunAt);
      if (!hasFutureRuleOccurrence) {
        throw conflict(
          "Cannot move this Calendar series because discarding its future exceptions leaves no future rule occurrence",
        );
      }

      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          projectId: targetProjectId,
          metadata: JSON.stringify(metadata),
          nextRunAt,
          scheduleRevision: { increment: 1 },
        },
        select: { scheduleRevision: true },
      });
      const retired = await retireTaskScheduleFutureOccurrences(
        tx,
        id,
        changedAt,
      );
      await createTaskSchedulePlannedOccurrences(
        tx,
        {
          id,
          workspaceId: currentTask.workspaceId,
          projectId: targetProjectId,
          schedule: metadata,
          nextRunAt,
        },
        changedAt,
      );

      const mutationResponse = taskScheduleSourceMutationSchema.parse({
        previousSource: sourceFromProjectId(currentTask.projectId),
        source,
        scheduleRevision: updatedTask.scheduleRevision,
        canceledFutureExceptionCount: retired.canceledCount,
      });
      const event = await tx.taskEvent.create({
        data: {
          taskId: id,
          ...resolveTaskEventActorFields(authContext),
          scheduleKind: TaskScheduleEventKind.SOURCE_CHANGED,
          scheduleOperationId: operationId,
          schedulePayload: {
            action: "move_source",
            requestFingerprint,
            workspaceId: currentTask.workspaceId,
            previousSource: mutationResponse.previousSource,
            source: mutationResponse.source,
            epochId: metadata.epochId,
            nextRunAt: nextRunAt.toISOString(),
            response: mutationResponse,
          },
        },
        select: { id: true },
      });

      return {
        response: mutationResponse,
        notification: {
          eventId: event.id,
          actorUserId: userContext?.userId ?? null,
          ownerId: currentTask.ownerId,
          taskName: currentTask.name,
        },
      };
    }, "Task source changed during Calendar move").catch((error: unknown) => {
      if (error instanceof TaskScheduleOccurrenceLimitError) {
        throw badRequest(error.message);
      }
      throw error;
    });

    await Promise.all([
      notifyTaskCalendarAction({
        taskId: id,
        taskName: response.notification.taskName,
        ownerId: response.notification.ownerId,
        actorUserId: response.notification.actorUserId,
        eventId: response.notification.eventId,
        messageKey: "Notifications.Task.scheduleSourceChangedByMember",
        action: "move_source",
      }),
      deliverCalendarInvalidationsNow(existingTask.workspaceId),
    ]);

    return ok(c, response.response);
  });
}

import { randomUUID } from "node:crypto";

import { createRoute, z } from "@hono/zod-openapi";
import { TaskScheduleEventKind, TaskStatus } from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  parseTaskScheduleMetadata,
} from "@sokosumi/utils";

import { requireTaskCollaboration } from "@/helpers/access-control";
import { requireCalendarBetaAccess } from "@/helpers/calendar-beta-access";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { badRequest, conflict, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { ok } from "@/helpers/response";
import { mapTask, validateTaskAssigneeAssignment } from "@/helpers/task";
import {
  buildTaskScheduleMetadataV2,
  computeScheduleNextRun,
  isSchedulableTaskStatus,
  validateScheduleInput,
} from "@/helpers/task-schedule";
import {
  createTaskSchedulePlannedOccurrences,
  retireTaskScheduleFutureOccurrences,
  TaskScheduleOccurrenceLimitError,
} from "@/helpers/task-schedule-occurrence-index";
import {
  canonicalTaskScheduleInput,
  createTaskScheduleRequestFingerprint,
  isTaskScheduleOperationReplay,
} from "@/helpers/task-schedule-operation";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import { putCalendarTaskScheduleRequestSchema } from "@/schemas/task-schedule.schema";
import { buildTaskIncludeForViewer } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "put",
  path: "/{id}/calendar-schedule",
  description:
    "Replace a Calendar schedule series, lazily converting legacy metadata to a mutable epoch. Idempotent per operationId and guarded by the observed schedule revision.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: putCalendarTaskScheduleRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Calendar task schedule saved"),
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
    const { id } = c.req.valid("param");
    const { operationId, expectedScheduleRevision, schedule } =
      c.req.valid("json");
    validateScheduleInput(schedule);
    // The fingerprint describes the outcome the caller asked for. The observed
    // revision is a concurrency token, not part of that outcome, so a retry
    // stays an exact replay after the first attempt advanced the revision.
    const requestFingerprint = createTaskScheduleRequestFingerprint({
      action: "update_schedule",
      taskId: id,
      discardFutureExceptions: true,
      schedule: canonicalTaskScheduleInput(schedule),
    });

    const existingTask = await requireTaskCollaboration(
      authContext,
      id,
      prisma,
    );

    const task = await serializableTransaction(async (tx) => {
      if (
        !(await lockCalendarScope(tx, existingTask.workspaceId, [
          existingTask.projectId,
        ]))
      ) {
        throw conflict("Task Calendar source changed during schedule update");
      }
      if (!(await lockTaskRows(tx, [id]))) {
        throw conflict("Task changed during schedule update");
      }

      const currentTask = await requireTaskCollaboration(authContext, id, tx);
      if (
        currentTask.workspaceId !== existingTask.workspaceId ||
        currentTask.projectId !== existingTask.projectId
      ) {
        throw conflict("Task Calendar source changed during schedule update");
      }
      // A retry replays before any state check: the first attempt already
      // applied this operation and may have moved the Task and its revision on.
      if (
        await isTaskScheduleOperationReplay(tx, {
          taskId: id,
          operationId,
          requestFingerprint,
        })
      ) {
        return await tx.task.findUniqueOrThrow({
          where: { id },
          include: buildTaskIncludeForViewer(
            authContext,
            currentTask.workspaceId,
          ),
        });
      }
      if (expectedScheduleRevision !== currentTask.scheduleRevision) {
        throw conflict(
          "The schedule series changed; reload the Task and retry with its current scheduleRevision",
          { kind: CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT },
        );
      }
      if (!isSchedulableTaskStatus(currentTask.status)) {
        throw forbidden("You can only schedule draft, ready, or queued tasks");
      }
      await requireAssignedOrganizationSeat(
        userContext.userId,
        currentTask.organizationId,
        tx,
      );
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

      const persistedMetadata = parseTaskScheduleMetadata(currentTask.metadata);
      if (!persistedMetadata || !currentTask.nextRunAt) {
        throw conflict("Task does not have a valid active Calendar schedule");
      }

      const changedAt = new Date();
      // A full-series edit always starts a new epoch, including a legacy v1
      // series and a resubmission of the rule already stored: the confirmed
      // `discardFutureExceptions` must never silently no-op, and a fresh epoch
      // keeps the reprojected originals clear of the retired rows' identity.
      const metadata = buildTaskScheduleMetadataV2(
        schedule,
        changedAt,
        randomUUID(),
      );
      const nextRunAt = computeScheduleNextRun(metadata);
      if (!nextRunAt) {
        throw badRequest("Unable to compute the next scheduled run");
      }

      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          metadata: JSON.stringify(metadata),
          nextRunAt,
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

      // Future exceptions belong to the epoch that defined them, so the old
      // epoch's future half is retired before the new epoch is projected.
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
          projectId: currentTask.projectId,
          schedule: metadata,
          nextRunAt,
        },
        changedAt,
      );

      await tx.taskEvent.create({
        data: {
          taskId: id,
          userId: userContext.userId,
          scheduleKind: TaskScheduleEventKind.UPDATED,
          scheduleOperationId: operationId,
          schedulePayload: {
            action: "update_schedule",
            requestFingerprint,
            workspaceId: currentTask.workspaceId,
            projectId: currentTask.projectId,
            epochId: metadata.epochId,
            nextRunAt: nextRunAt.toISOString(),
            scheduleRevision: updatedTask.scheduleRevision,
            canceledFutureExceptionCount: retired.canceledCount,
          },
        },
        select: { id: true },
      });
      return updatedTask;
    }, "Task schedule changed during Calendar update").catch(
      (error: unknown) => {
        if (error instanceof TaskScheduleOccurrenceLimitError) {
          throw badRequest(error.message);
        }
        throw error;
      },
    );

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

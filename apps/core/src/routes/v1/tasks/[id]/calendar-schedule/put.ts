import { randomUUID } from "node:crypto";

import { createRoute, z } from "@hono/zod-openapi";
import { TaskScheduleOccurrenceState, TaskStatus } from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  isNmkrEmail,
  parseTaskScheduleMetadata,
  type TaskScheduleMetadataV2,
} from "@sokosumi/utils";

import { requireTaskCollaboration } from "@/helpers/access-control";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { badRequest, conflict, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { ok } from "@/helpers/response";
import { mapTask, validateTaskAssigneeAssignment } from "@/helpers/task";
import {
  buildUpdatedTaskScheduleMetadataV2,
  computeScheduleNextRun,
  convertTaskScheduleMetadataV1ToV2,
  isSchedulableTaskStatus,
  validateScheduleInput,
} from "@/helpers/task-schedule";
import {
  replaceTaskSchedulePlannedOccurrences,
  TaskScheduleOccurrenceLimitError,
} from "@/helpers/task-schedule-occurrence-index";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import {
  getTaskScheduleInput,
  putTaskScheduleRequestSchema,
} from "@/schemas/task-schedule.schema";
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
    "Update a Calendar schedule, lazily converting legacy metadata to a mutable epoch",
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
    const user = await prisma.user.findUnique({
      where: { id: userContext.userId },
      select: { email: true },
    });
    if (!isNmkrEmail(user?.email)) {
      throw forbidden("Calendar is only available to NMKR users");
    }
    const { id } = c.req.valid("param");
    const schedule = getTaskScheduleInput(c.req.valid("json"));
    validateScheduleInput(schedule);

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
        status: TaskStatus.QUEUED,
        assigneeId: currentTask.assigneeId,
        assigneeSokoBotId: currentTask.assigneeSokoBotId,
      });

      const persistedMetadata = parseTaskScheduleMetadata(currentTask.metadata);
      if (!persistedMetadata || !currentTask.nextRunAt) {
        throw conflict("Task does not have a valid active Calendar schedule");
      }

      const changedAt = new Date();
      let activeMetadata: TaskScheduleMetadataV2;
      if (persistedMetadata.version === 1) {
        const releasedOccurrenceCount =
          persistedMetadata.mode === "recurring"
            ? await tx.taskScheduleOccurrence.count({
                where: {
                  seriesTaskId: id,
                  state: TaskScheduleOccurrenceState.RELEASED,
                  scheduleVersion: 1,
                  ruleSnapshot: {
                    path: ["scheduledAt"],
                    equals: persistedMetadata.scheduledAt,
                  },
                },
              })
            : 0;
        activeMetadata = convertTaskScheduleMetadataV1ToV2(
          persistedMetadata,
          changedAt,
          randomUUID(),
          releasedOccurrenceCount,
        );
        await tx.task.update({
          where: { id },
          data: { metadata: JSON.stringify(activeMetadata) },
        });
      } else {
        activeMetadata = persistedMetadata;
      }

      const metadata = buildUpdatedTaskScheduleMetadataV2(
        schedule,
        activeMetadata,
        changedAt,
        randomUUID(),
      );
      const nextRunAt =
        metadata === activeMetadata
          ? currentTask.nextRunAt
          : computeScheduleNextRun(metadata);
      if (!nextRunAt) {
        throw badRequest("Unable to compute the next scheduled run");
      }

      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          metadata: JSON.stringify(metadata),
          nextRunAt,
          ...(currentTask.status !== TaskStatus.QUEUED
            ? { status: TaskStatus.QUEUED }
            : {}),
        },
        include: buildTaskIncludeForViewer(
          authContext,
          currentTask.workspaceId,
        ),
      });
      await replaceTaskSchedulePlannedOccurrences(tx, {
        id,
        workspaceId: currentTask.workspaceId,
        projectId: currentTask.projectId,
        schedule: metadata,
        nextRunAt,
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

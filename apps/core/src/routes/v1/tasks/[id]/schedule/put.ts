import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { requireTaskCollaboration } from "@/helpers/access-control";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { badRequest, conflict, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { ok } from "@/helpers/response";
import { mapTask, validateTaskAssigneeAssignment } from "@/helpers/task";
import {
  buildTaskScheduleMetadata,
  computeScheduleNextRun,
  isSchedulableTaskStatus,
  validateScheduleInput,
} from "@/helpers/task-schedule";
import {
  replaceTaskSchedulePlannedOccurrences,
  TaskScheduleOccurrenceLimitError,
} from "@/helpers/task-schedule-occurrence-index";
import prisma from "@/lib/db/prisma";
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
    const userContext = requireOwnerUserContext(authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const schedule = getTaskScheduleInput(body);

    validateScheduleInput(schedule);

    const scheduledAt = new Date();
    const metadata = buildTaskScheduleMetadata(schedule, scheduledAt);
    const nextRunAt = computeScheduleNextRun(metadata);
    if (!nextRunAt) {
      throw badRequest("Unable to compute the next scheduled run");
    }

    const existingTask = await requireTaskCollaboration(
      authContext,
      id,
      prisma,
    );

    const task = await prisma
      .$transaction(async (tx) => {
        const locked = await lockCalendarScope(tx, existingTask.workspaceId, [
          existingTask.projectId,
        ]);
        if (!locked) {
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
          throw forbidden(
            "You can only schedule draft, ready, or queued tasks",
          );
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

        const task = await tx.task.update({
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
        return task;
      })
      .catch((error: unknown) => {
        if (error instanceof TaskScheduleOccurrenceLimitError) {
          throw badRequest(error.message);
        }
        throw error;
      });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

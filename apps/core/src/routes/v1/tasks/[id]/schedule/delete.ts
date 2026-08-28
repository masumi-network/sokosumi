import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { requireMutableTaskOwnership } from "@/helpers/access-control";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import { removeTaskSchedulePlannedOccurrences } from "@/helpers/task-schedule-occurrence-index";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import { buildTaskIncludeForViewer } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}/schedule",
  description: "Remove a task schedule",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Task schedule removed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireOwnerUserContext(authContext);
    const { id } = c.req.valid("param");
    const existingTask = await requireMutableTaskOwnership(
      userContext,
      id,
      prisma,
    );

    const task = await prisma.$transaction(async (tx) => {
      const scopeLocked = await lockCalendarScope(
        tx,
        existingTask.workspaceId,
        [existingTask.projectId],
      );
      if (!scopeLocked || !(await lockTaskRows(tx, [id]))) {
        throw conflict("Task changed during schedule removal");
      }

      const currentTask = await requireMutableTaskOwnership(
        userContext,
        id,
        tx,
      );
      if (
        currentTask.workspaceId !== existingTask.workspaceId ||
        currentTask.projectId !== existingTask.projectId
      ) {
        throw conflict("Task Calendar source changed during schedule removal");
      }
      const quarantine = await tx.taskScheduleQuarantine.findUnique({
        where: { taskId: id },
        select: { id: true },
      });
      if (quarantine) {
        throw conflict(
          "This schedule is quarantined and requires audited operator removal",
          { kind: CORE_API_ERROR_KINDS.SCHEDULE_QUARANTINED },
        );
      }

      const task = await tx.task.update({
        where: { id },
        data: {
          metadata: null,
          nextRunAt: null,
          ...(currentTask.status === TaskStatus.QUEUED
            ? { status: TaskStatus.DRAFT }
            : {}),
        },
        include: buildTaskIncludeForViewer(
          authContext,
          currentTask.workspaceId,
        ),
      });
      await removeTaskSchedulePlannedOccurrences(tx, id);
      return task;
    });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

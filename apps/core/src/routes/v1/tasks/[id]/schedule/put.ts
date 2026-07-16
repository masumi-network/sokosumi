import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { requireTaskCollaboration } from "@/helpers/access-control";
import { badRequest, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask, validateTaskCoworkerAssignment } from "@/helpers/task";
import {
  buildTaskScheduleMetadata,
  computeScheduleNextRun,
  validateScheduleInput,
} from "@/helpers/task-schedule";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskSchema } from "@/schemas/task.schema";
import { putTaskScheduleRequestSchema } from "@/schemas/task-schedule.schema";
import { buildTaskIncludeForViewer } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const SCHEDULABLE_STATUSES: TaskStatus[] = [
  TaskStatus.DRAFT,
  TaskStatus.READY,
  TaskStatus.QUEUED,
];

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
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    validateScheduleInput(body);

    const scheduledAt = new Date();
    const metadata = buildTaskScheduleMetadata(body, scheduledAt);
    const nextRunAt = computeScheduleNextRun(metadata);
    if (!nextRunAt) {
      throw badRequest("Unable to compute the next scheduled run");
    }

    const existingTask = await requireTaskCollaboration(
      authContext,
      id,
      prisma,
    );

    if (!SCHEDULABLE_STATUSES.includes(existingTask.status)) {
      throw forbidden("You can only schedule draft, ready, or queued tasks");
    }

    const nextStatus =
      existingTask.status !== TaskStatus.QUEUED
        ? TaskStatus.QUEUED
        : existingTask.status;

    if (nextStatus === TaskStatus.QUEUED) {
      validateTaskCoworkerAssignment({
        status: TaskStatus.QUEUED,
        coworkerId: existingTask.coworkerId,
      });
    }

    const task = await prisma.$transaction(async (tx) => {
      await requireTaskCollaboration(authContext, id, tx);

      return tx.task.update({
        where: { id },
        data: {
          metadata: JSON.stringify(metadata),
          nextRunAt,
          ...(nextStatus !== existingTask.status ? { status: nextStatus } : {}),
        },
        include: buildTaskIncludeForViewer(
          authContext,
          existingTask.workspaceId,
        ),
      });
    });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

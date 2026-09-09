import { createRoute, z } from "@hono/zod-openapi";
import { TaskScheduleEventKind, TaskStatus } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { requireTaskCollaboration } from "@/helpers/access-control";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import { isSchedulableTaskStatus } from "@/helpers/task-schedule";
import { retireTaskScheduleFutureOccurrences } from "@/helpers/task-schedule-occurrence-index";
import {
  createTaskScheduleRequestFingerprint,
  isTaskScheduleOperationReplay,
} from "@/helpers/task-schedule-operation";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
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

/**
 * The removal has no body, so its concurrency token travels as an `If-Match`
 * entity tag over the schedule revision. Only this exact form is accepted —
 * `*` and other validators would silently skip the revision check.
 */
const SCHEDULE_REVISION_ETAG_PATTERN = /^"schedule-revision:(0|[1-9]\d*)"$/;

// Hono lower-cases request header names before validation, and zod-to-openapi
// documents each parameter under its schema key, so these keys are the
// canonical `Idempotency-Key` / `If-Match` headers in their matched-case form.
const headersSchema = z.object({
  "idempotency-key": z
    .string()
    .uuid()
    .openapi({
      param: { in: "header" },
      description: "Idempotency identity for this series removal",
      example: "123e4567-e89b-42d3-a456-426614174000",
    }),
  "if-match": z
    .string()
    .regex(
      SCHEDULE_REVISION_ETAG_PATTERN,
      'If-Match must be "schedule-revision:{n}"',
    )
    .openapi({
      param: { in: "header" },
      description: "Schedule revision observed by the caller, as an entity tag",
      example: '"schedule-revision:3"',
    }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}/schedule",
  description:
    "Remove a Calendar schedule series. Idempotent per Idempotency-Key and guarded by the If-Match schedule revision.",
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
    // Removal still requires an interactive human with Task collaboration, but
    // deliberately not Calendar beta access: it is the escape hatch for every
    // schedule, including the ones the un-gated legacy route still creates.
    const userContext = requireOwnerUserContext(authContext);
    const { id } = c.req.valid("param");
    const { "idempotency-key": operationId, "if-match": scheduleRevisionETag } =
      c.req.valid("header");
    // The header schema already enforced this shape, so the capture is present.
    const expectedScheduleRevision = Number(
      SCHEDULE_REVISION_ETAG_PATTERN.exec(scheduleRevisionETag)?.[1],
    );
    // Removal has one possible outcome per Task, so its identity is the whole
    // request; reusing the key for an edit hashes differently and conflicts.
    const requestFingerprint = createTaskScheduleRequestFingerprint({
      action: "remove_schedule",
      taskId: id,
    });

    const existingTask = await requireTaskCollaboration(
      authContext,
      id,
      prisma,
    );

    const task = await serializableTransaction(async (tx) => {
      const scopeLocked = await lockCalendarScope(
        tx,
        existingTask.workspaceId,
        [existingTask.projectId],
      );
      if (!scopeLocked || !(await lockTaskRows(tx, [id]))) {
        throw conflict("Task changed during schedule removal");
      }

      const currentTask = await requireTaskCollaboration(authContext, id, tx);
      if (
        currentTask.workspaceId !== existingTask.workspaceId ||
        currentTask.projectId !== existingTask.projectId
      ) {
        throw conflict("Task Calendar source changed during schedule removal");
      }

      // A retry replays before any state check: the first attempt already
      // cleared the series and advanced the revision the caller observed.
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
      // Quarantine is reported ahead of the revision so a caller holding a
      // stale revision is not sent to reload and retry into a 409 it cannot
      // resolve by reloading.
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
      const retired = await retireTaskScheduleFutureOccurrences(
        tx,
        id,
        new Date(),
      );
      await tx.taskEvent.create({
        data: {
          taskId: id,
          userId: userContext.userId,
          scheduleKind: TaskScheduleEventKind.REMOVED,
          scheduleOperationId: operationId,
          schedulePayload: {
            action: "remove_schedule",
            requestFingerprint,
            workspaceId: currentTask.workspaceId,
            projectId: currentTask.projectId,
            scheduleRevision: task.scheduleRevision,
            canceledFutureExceptionCount: retired.canceledCount,
          },
        },
        select: { id: true },
      });
      return task;
    }, "Task schedule changed during schedule removal");

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  hasActiveTaskSchedule,
  isTaskEditableStatus,
} from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import {
  requireMutableTaskOwnership,
  requireTaskAssignableCoworker,
  requireTaskAssignableSokoBot,
  requireTaskAssignableUser,
} from "@/helpers/access-control";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { conflict, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { ok } from "@/helpers/response";
import { mapTask, validateTaskAssigneeAssignment } from "@/helpers/task";
import {
  nextAssigneeWrite,
  refineAssigneeXorConflict,
  resolveAssigneeIdFromRequest,
} from "@/helpers/task-assignee-alias";
import { notifyTaskHumanAssignee } from "@/helpers/task-notifications";
import { assertTaskScheduleInactive } from "@/helpers/task-schedule";
import { refreshTaskSchedulePlannedOccurrences } from "@/helpers/task-schedule-occurrence-index";
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

export const patchTaskRequestSchema = z
  .object({
    name: z.string().min(1).max(LIMITS.NAME_MAX_LENGTH).optional().openapi({
      example: "Updated task title",
    }),
    description: z.string().nullish().openapi({
      example: "Updated description",
    }),
    projectId: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .openapi({ example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" }),
    assigneeId: z.string().nullish().openapi({ example: "cow_123" }),
    /** @deprecated Use `assigneeId`. */
    coworkerId: z.string().nullish().openapi({
      example: "cow_123",
      deprecated: true,
      description: "Deprecated. Use assigneeId instead.",
    }),
    assigneeSokoBotId: z.string().uuid().nullish().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    assigneeUserId: z.string().nullish().openapi({ example: "user_123" }),
    /**
     * Required while the Task has an active Calendar schedule series: the
     * revision observed by the client, checked under the Calendar/Task locks.
     */
    expectedScheduleRevision: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .openapi({
        example: 3,
      }),
  })
  .superRefine((data, ctx) => {
    refineAssigneeXorConflict(data, ctx);

    if (
      data.name === undefined &&
      data.description === undefined &&
      data.projectId === undefined &&
      data.assigneeId === undefined &&
      data.coworkerId === undefined &&
      data.assigneeSokoBotId === undefined &&
      data.assigneeUserId === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "At least one of name, description, projectId, assigneeId, assigneeSokoBotId, or assigneeUserId is required",
        path: ["name"],
      });
    }
  })
  .transform((data) => {
    const { coworkerId: _coworkerId, ...rest } = data;
    const assigneeId = resolveAssigneeIdFromRequest(data);
    return {
      ...rest,
      // Only set when either alias was provided so omitted patches keep the
      // existing assignee (handler treats `undefined` as "not provided").
      ...(data.assigneeId !== undefined || data.coworkerId !== undefined
        ? { assigneeId }
        : {}),
    };
  });

const route = createRoute({
  method: "patch",
  path: "/{id}",
  description: "Update task metadata",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: patchTaskRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Update task"),
    400: jsonErrorResponse("Bad Request"),
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
    const {
      name,
      description,
      projectId,
      assigneeId,
      assigneeSokoBotId,
      assigneeUserId,
      expectedScheduleRevision,
    } = c.req.valid("json");
    const editsTaskFields =
      name !== undefined ||
      description !== undefined ||
      assigneeId !== undefined ||
      assigneeSokoBotId !== undefined ||
      assigneeUserId !== undefined;

    const result = await prisma.$transaction(async (tx) => {
      const taskSnapshot = await requireMutableTaskOwnership(
        userContext,
        id,
        tx,
      );
      const projectIdWasProvided = projectId !== undefined;
      if (projectIdWasProvided && projectId !== null) {
        const project = await tx.project.findFirst({
          where: {
            id: projectId,
            workspaceId: taskSnapshot.workspaceId,
          },
          select: { id: true },
        });

        if (!project) {
          throw notFound("Project not found");
        }
      }

      if (
        !(await lockCalendarScope(tx, taskSnapshot.workspaceId, [
          taskSnapshot.projectId,
          projectId,
        ])) ||
        !(await lockTaskRows(tx, [taskSnapshot.id]))
      ) {
        throw conflict("Task changed during update");
      }

      const task = await requireMutableTaskOwnership(userContext, id, tx);
      await requireAssignedOrganizationSeat(
        userContext.userId,
        task.organizationId,
        tx,
      );
      if (task.workspaceId !== taskSnapshot.workspaceId) {
        throw conflict("Task changed during update");
      }

      if (!isTaskEditableStatus(task.status)) {
        throw forbidden("You can only update draft, queued, or ready tasks");
      }

      // A live schedule series owns the Task's placement and its revision:
      // moving the Calendar source belongs to SOK-887, and field edits must
      // serialize against release through `expectedScheduleRevision`.
      const hasActiveSeries = hasActiveTaskSchedule(
        task.metadata,
        task.nextRunAt,
      );
      if (projectIdWasProvided && (projectId ?? null) !== task.projectId) {
        assertTaskScheduleInactive(
          task,
          "Remove or replace the schedule before moving this Task's Calendar source",
        );
      }
      if (
        hasActiveSeries &&
        editsTaskFields &&
        expectedScheduleRevision !== task.scheduleRevision
      ) {
        throw conflict(
          "The schedule series changed; reload the Task and retry with its current scheduleRevision",
          { kind: CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT },
        );
      }

      const assigneeWrite = nextAssigneeWrite({
        assigneeId,
        assigneeSokoBotId,
        assigneeUserId,
      });
      const nextAssigneeId = assigneeWrite
        ? assigneeWrite.assigneeId
        : task.assigneeId;
      const nextAssigneeSokoBotId = assigneeWrite
        ? assigneeWrite.assigneeSokoBotId
        : task.assigneeSokoBotId;
      const nextAssigneeUserId = assigneeWrite
        ? assigneeWrite.assigneeUserId
        : task.assigneeUserId;
      validateTaskAssigneeAssignment({
        status: task.status,
        assigneeId: nextAssigneeId,
        assigneeSokoBotId: nextAssigneeSokoBotId,
        assigneeUserId: nextAssigneeUserId,
      });

      if (assigneeWrite?.assigneeId) {
        await requireTaskAssignableCoworker(
          assigneeWrite.assigneeId,
          task.workspaceId,
          tx,
          {
            kind: "user",
            userId: userContext.userId,
          },
        );
      }
      if (assigneeWrite?.assigneeSokoBotId) {
        await requireTaskAssignableSokoBot(
          assigneeWrite.assigneeSokoBotId,
          task.workspaceId,
          tx,
          {
            kind: "user",
            userId: userContext.userId,
          },
        );
      }
      if (assigneeWrite?.assigneeUserId) {
        await requireTaskAssignableUser(
          assigneeWrite.assigneeUserId,
          task.workspaceId,
          tx,
        );
      }

      const previousAssigneeUserId = task.assigneeUserId;

      const updatedTask = await tx.task.update({
        where: {
          id,
          ownerId: userContext.userId,
          archivedAt: null,
          status: {
            in: [TaskStatus.DRAFT, TaskStatus.QUEUED, TaskStatus.READY],
          },
        },
        data: {
          name,
          description,
          projectId,
          ...(assigneeWrite ?? {}),
          ...(hasActiveSeries && editsTaskFields
            ? { scheduleRevision: { increment: 1 } }
            : {}),
        },
        include: buildTaskIncludeForViewer(authContext, task.workspaceId),
      });
      if (projectIdWasProvided) {
        await refreshTaskSchedulePlannedOccurrences(tx, {
          id: task.id,
          workspaceId: task.workspaceId,
          projectId: projectId ?? null,
          status: task.status,
          metadata: task.metadata,
          nextRunAt: task.nextRunAt,
        });
      }
      return { task: updatedTask, previousAssigneeUserId };
    });

    if (
      result.previousAssigneeUserId !== result.task.assigneeUserId &&
      result.task.assigneeUserId
    ) {
      await notifyTaskHumanAssignee(result.task.id, result.task.assigneeUserId);
    }

    return ok(c, taskSchema.parse(mapTask(result.task)));
  });
}

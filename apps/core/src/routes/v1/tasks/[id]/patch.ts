import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { Channel, TaskStatus } from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  hasActiveTaskSchedule,
  isTaskEditableStatus,
  parseTaskContextFromDescription,
  removeTaskContextAttachmentLinks,
} from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import {
  requireMutableTaskOwnership,
  requireTaskAssignableCoworker,
  requireTaskAssignableSokoBot,
  requireTaskAssignableUser,
} from "@/helpers/access-control";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { dateTimeSchema } from "@/helpers/datetime";
import {
  conflict,
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { ok } from "@/helpers/response";
import {
  mapTask,
  parseFutureRunAt,
  validateTaskAssigneeAssignment,
} from "@/helpers/task";
import {
  nextAssigneeWrite,
  refineAssigneeXorConflict,
  resolveAssigneeIdFromRequest,
} from "@/helpers/task-assignee-alias";
import {
  findTaskProjectInWorkspace,
  healProjectBriefingUrl,
  resolveTaskDescriptionWithContext,
} from "@/helpers/task-create-context";
import { resolveTaskEventActorFields } from "@/helpers/task-event-actor";
import {
  markTaskAssignedRead,
  notifyTaskHumanAssignee,
} from "@/helpers/task-notifications";
import { assertTaskScheduleInactive } from "@/helpers/task-schedule";
import { refreshTaskSchedulePlannedOccurrences } from "@/helpers/task-schedule-occurrence-index";
import { publishTaskEventData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { createTaskContextSchema, taskSchema } from "@/schemas/task.schema";
import { requireNoHumanAssigneeOnPrivateTask } from "@/services/task-domain.service";
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
    context: createTaskContextSchema.optional().openapi({
      description:
        "When set, Core strips existing DESIGN.md / BRIEFING.md / CONTEXT.md links from the description (request body or stored) and re-applies Context the same way as create.",
    }),
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
    runAt: dateTimeSchema.nullish().openapi({
      description:
        "Future time the Task moves to Ready. Setting it puts the Task in QUEUED (requires a Coworker or Soko Bot assignee); null on a QUEUED Task clears it and moves the Task back to DRAFT.",
      example: "2026-06-24T09:00:00.000Z",
    }),
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
      data.context === undefined &&
      data.assigneeId === undefined &&
      data.coworkerId === undefined &&
      data.assigneeSokoBotId === undefined &&
      data.assigneeUserId === undefined &&
      data.runAt === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "At least one of name, description, projectId, context, assigneeId, assigneeSokoBotId, assigneeUserId, or runAt is required",
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
    422: jsonErrorResponse("Unprocessable Entity"),
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
      context,
      assigneeId,
      assigneeSokoBotId,
      assigneeUserId,
      runAt,
      expectedScheduleRevision,
    } = c.req.valid("json");
    const editsTaskFields =
      name !== undefined ||
      description !== undefined ||
      context !== undefined ||
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
        !(await lockCalendarScope(
          tx,
          taskSnapshot.workspaceId,
          [taskSnapshot.projectId, projectId],
          userContext.userId,
        )) ||
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

      // Setting a Run at queues the Task; clearing it on a Queued Task sends
      // it back to Draft, since Queued needs a Run at (ADR 0041).
      let runAtWrite: Date | null | undefined;
      let nextStatus = task.status;
      if (runAt !== undefined) {
        assertTaskScheduleInactive(
          task,
          "Remove the schedule before setting this Task's Run at",
        );
        runAtWrite = runAt === null ? null : parseFutureRunAt(runAt);
        if (runAtWrite) {
          nextStatus = TaskStatus.QUEUED;
        } else if (task.status === TaskStatus.QUEUED) {
          nextStatus = TaskStatus.DRAFT;
        }
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
        status: nextStatus,
        assigneeId: nextAssigneeId,
        assigneeSokoBotId: nextAssigneeSokoBotId,
        assigneeUserId: nextAssigneeUserId,
      });
      requireNoHumanAssigneeOnPrivateTask(task.visibility, nextAssigneeUserId);

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

      let nextDescription = description;
      if (context !== undefined) {
        const effectiveProjectId = projectIdWasProvided
          ? projectId
          : task.projectId;
        const contextProject = await findTaskProjectInWorkspace(
          effectiveProjectId,
          task.workspaceId,
          tx,
        );
        const healedProject =
          context.briefing !== false
            ? await healProjectBriefingUrl(contextProject, task.workspaceId, tx)
            : contextProject;
        const proseSource =
          description !== undefined
            ? (description ?? "")
            : (task.description ?? "");
        const preservedBrandUrl = parseTaskContextFromDescription(
          task.description ?? "",
        ).selection.brandUrl;
        nextDescription = await resolveTaskDescriptionWithContext({
          context,
          description: removeTaskContextAttachmentLinks(proseSource) || null,
          organizationId: task.organizationId,
          ownerId: task.ownerId,
          project: healedProject,
          preservedBrandUrl,
          tx,
        });
        if (!nextDescription?.trim()) {
          throw unprocessableEntity(
            "Description required when Context resolves to no attachments",
          );
        }
      }

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
          description: nextDescription,
          projectId,
          ...(assigneeWrite ?? {}),
          runAt: runAtWrite,
          ...(nextStatus !== task.status ? { status: nextStatus } : {}),
          ...(hasActiveSeries && editsTaskFields
            ? { scheduleRevision: { increment: 1 } }
            : {}),
        },
        include: buildTaskIncludeForViewer(authContext, task.workspaceId),
      });
      if (nextStatus !== task.status) {
        await tx.taskEvent.create({
          data: {
            taskId: id,
            status: nextStatus,
            channel: Channel.SOKOSUMI,
            ...resolveTaskEventActorFields(authContext),
          },
        });
      }
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
      return {
        task: updatedTask,
        previousAssigneeUserId,
        workspaceId: task.workspaceId,
        statusChanged: nextStatus !== task.status,
      };
    });
    await deliverCalendarInvalidationsNow(result.workspaceId);
    // Same signal as POST /tasks/{id}/events: open boards refresh on it.
    // A Run at time move stays Queued, so it does not publish.
    if (result.statusChanged) {
      try {
        await publishTaskEventData({
          userId: result.task.ownerId,
          taskId: result.task.id,
          eventType: "task_event",
        });
      } catch (error) {
        Sentry.captureException(error, {
          tags: { error_type: "publish_task_event" },
          extra: {
            taskId: result.task.id,
            userId: result.task.ownerId,
          },
        });
      }
    }

    if (result.previousAssigneeUserId !== result.task.assigneeUserId) {
      if (result.previousAssigneeUserId) {
        await markTaskAssignedRead(
          result.previousAssigneeUserId,
          result.task.id,
        );
      }

      if (result.task.assigneeUserId) {
        await notifyTaskHumanAssignee(
          result.task.id,
          result.task.assigneeUserId,
        );
      }
    }

    return ok(c, taskSchema.parse(mapTask(result.task, authContext)));
  });
}

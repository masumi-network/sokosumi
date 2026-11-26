import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { Channel, TaskStatus } from "@sokosumi/database";
import {
  calendarDateSchema,
  isTaskEditableStatus,
  parseTaskContextFromDescription,
  removeTaskContextAttachmentLinks,
} from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";

import { LIMITS } from "@/config/constants";
import {
  requireMutableTaskWriteAccess,
  requireTaskAssignableCoworker,
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
  requireSeoTaskExecutionUnchanged,
  seoAuditTextUnchanged,
} from "@/helpers/seo-task-execution";
import { requireTaskAssignableSokoBot } from "@/helpers/soko-bot-task-assign";
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
import { recordTaskDueDateMovedLater } from "@/helpers/task-due-date-change";
import { resolveTaskEventActorFields } from "@/helpers/task-event-actor";
import {
  markTaskAssignedRead,
  notifyTaskHumanAssignee,
  notifyTaskStatusEvent,
} from "@/helpers/task-notifications";
import {
  reopenedWithoutInstructionsComment,
  taskReopenedWithoutInstructions,
} from "@/helpers/task-reopen-instructions";
import {
  requireNotSubtask,
  requireSubtreeCanChangeProject,
} from "@/helpers/task-subtasks";
import { dismissTaskTopics } from "@/helpers/task-tags";
import {
  requireExpectedTaskWorkspaceTags,
  setTaskWorkspaceTags,
} from "@/helpers/task-workspace-tags";
import { publishTaskEventData } from "@/lib/ably/publish";
import { retriedTransaction } from "@/lib/db/transaction";
import { runAsBackgroundWork } from "@/lib/evlog";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { taskPrioritySchema } from "@/schemas/domain-enums.schema";
import {
  createTaskContextSchema,
  dismissedTopicIdsSchema,
  dismissedWorkspaceTagIdsSchema,
  taskSchema,
  taskWorkspaceTagIdsSchema,
} from "@/schemas/task.schema";
import { requireNoHumanAssigneeOnPrivateTask } from "@/services/task-domain.service";
import { buildTaskIncludeForViewer, taskEventApiInclude } from "@/types/task";

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
    priority: taskPrioritySchema.optional(),
    workspaceTagIds: taskWorkspaceTagIdsSchema,
    expectedWorkspaceTagIds: z.array(z.uuid()).optional().openapi({
      description:
        "When replacing workspaceTagIds, return 409 if the currently applied workspace tags differ from this set.",
    }),
    dismissedWorkspaceTagIds: dismissedWorkspaceTagIdsSchema,
    dismissedTopicIds: dismissedTopicIdsSchema,
    runAt: dateTimeSchema.nullish().openapi({
      description:
        "Future time the Task moves to Ready. Setting it puts the Task in QUEUED (requires a Coworker or Soko Bot assignee); null on a QUEUED Task clears it and moves the Task back to DRAFT.",
      example: "2026-06-24T09:00:00.000Z",
    }),
    dueOn: calendarDateSchema.nullish().openapi({
      description:
        "The day the Task should be done by (YYYY-MM-DD); null clears it. A request that changes only dueOn also works outside draft, queued and ready, except on a Task parked in GRANT_PENDING.",
      example: "2026-11-20",
    }),
  })
  .superRefine((data, ctx) => {
    refineAssigneeXorConflict(data, ctx);
    if (
      data.expectedWorkspaceTagIds !== undefined &&
      data.workspaceTagIds === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "expectedWorkspaceTagIds requires workspaceTagIds",
        path: ["expectedWorkspaceTagIds"],
      });
    }

    if (
      data.name === undefined &&
      data.description === undefined &&
      data.projectId === undefined &&
      data.context === undefined &&
      data.assigneeId === undefined &&
      data.coworkerId === undefined &&
      data.assigneeSokoBotId === undefined &&
      data.assigneeUserId === undefined &&
      data.priority === undefined &&
      data.runAt === undefined &&
      data.dueOn === undefined &&
      data.workspaceTagIds === undefined &&
      data.dismissedWorkspaceTagIds === undefined &&
      data.dismissedTopicIds === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "At least one of name, description, projectId, context, assigneeId, assigneeSokoBotId, assigneeUserId, priority, runAt, dueOn, workspaceTagIds, dismissedWorkspaceTagIds, or dismissedTopicIds is required",
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
      description: requestedDescription,
      projectId,
      context,
      assigneeId,
      assigneeSokoBotId,
      assigneeUserId,
      priority,
      runAt,
      dueOn,
      workspaceTagIds,
      expectedWorkspaceTagIds,
      dismissedWorkspaceTagIds,
      dismissedTopicIds,
    } = c.req.valid("json");
    const editsWorkspaceTags =
      workspaceTagIds !== undefined || dismissedWorkspaceTagIds !== undefined;
    const editsTags = editsWorkspaceTags || dismissedTopicIds !== undefined;
    // A due date belongs to the work, not the brief, so it may change while
    // the Task runs or after it ends. The same applies to workspace tags.
    const onlyDueOnOrTags =
      (dueOn !== undefined || editsTags) &&
      name === undefined &&
      requestedDescription === undefined &&
      projectId === undefined &&
      context === undefined &&
      assigneeId === undefined &&
      assigneeSokoBotId === undefined &&
      assigneeUserId === undefined &&
      priority === undefined &&
      runAt === undefined;

    const result = await retriedTransaction(async (tx) => {
      const taskSnapshot = await requireMutableTaskWriteAccess(
        userContext,
        id,
        tx,
      );
      if (
        editsTags &&
        taskSnapshot.workspaceId !==
          requireWorkspaceContext(c.var.workspaceContext).workspaceId
      ) {
        throw notFound("Task not found");
      }
      const projectIdWasProvided = projectId !== undefined;
      if (projectIdWasProvided && projectId !== taskSnapshot.projectId) {
        requireNotSubtask(taskSnapshot);
      }
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

      const task = await requireMutableTaskWriteAccess(userContext, id, tx);
      // Non-owners are seated inside write access, on the workspace org.
      // The owner check stays on the billing organizationId.
      if (task.ownerId === userContext.userId) {
        await requireAssignedOrganizationSeat(
          userContext.userId,
          task.organizationId,
          tx,
        );
      }
      if (task.workspaceId !== taskSnapshot.workspaceId) {
        throw conflict("Task changed during update");
      }

      if (expectedWorkspaceTagIds !== undefined) {
        await requireExpectedTaskWorkspaceTags(tx, id, expectedWorkspaceTagIds);
      }

      if (!onlyDueOnOrTags && !isTaskEditableStatus(task.status)) {
        throw forbidden("You can only update draft, queued, or ready tasks");
      }

      // Setting a Run at queues the Task; clearing it on a Queued Task sends
      // it back to Draft, since Queued needs a Run at (ADR 0041).
      let runAtWrite: Date | null | undefined;
      let nextStatus = task.status;
      if (runAt !== undefined) {
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
          {
            visibility: task.visibility,
            projectId: projectIdWasProvided ? projectId : task.projectId,
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

      // A Coworker or Soko Bot handed a silently reopened Task would run with
      // no instructions. It waits in Input required for a person to say what
      // to do (SOKD-279).
      // Queued work turns READY later on its own, so it parks the same way.
      // People read a full audit's description without its request line, so a
      // save of the text they saw keeps the stored description.
      const description = seoAuditTextUnchanged(
        task.description,
        requestedDescription,
      )
        ? undefined
        : requestedDescription;
      // The Web edit form sends the description with every save, so only a
      // changed one is new instructions.
      const newInstructions =
        typeof description === "string" &&
        description.trim() !== "" &&
        description.trim() !==
          parseTaskContextFromDescription(task.description ?? "").body.trim();
      const parksForInstructions =
        !newInstructions &&
        (nextStatus === TaskStatus.READY || nextStatus === TaskStatus.QUEUED) &&
        (nextAssigneeId ?? nextAssigneeSokoBotId) !== null &&
        // A new agent, or its own agent's Task queued again.
        (nextStatus !== task.status ||
          nextAssigneeId !== task.assigneeId ||
          nextAssigneeSokoBotId !== task.assigneeSokoBotId) &&
        (await taskReopenedWithoutInstructions(tx, id));
      if (parksForInstructions) {
        // Without the Run at, nothing starts it before a person answers.
        if (nextStatus === TaskStatus.QUEUED) runAtWrite = null;
        nextStatus = TaskStatus.INPUT_REQUIRED;
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
          ownerId: task.ownerId ?? userContext.userId,
          actorUserId: userContext.userId,
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

      await requireSeoTaskExecutionUnchanged(tx, task, {
        description: nextDescription,
        projectId,
        ...(assigneeWrite ?? {}),
      });
      if (projectIdWasProvided && projectId !== task.projectId) {
        await requireSubtreeCanChangeProject(tx, task.id);
      }
      const dueOnWrite =
        dueOn === undefined
          ? undefined
          : dueOn === null
            ? null
            : new Date(`${dueOn}T00:00:00.000Z`);
      if (editsWorkspaceTags) {
        await setTaskWorkspaceTags(
          tx,
          id,
          task.workspaceId,
          workspaceTagIds,
          dismissedWorkspaceTagIds,
        );
      }
      let updatedTask = await tx.task.update({
        where: {
          id,
          archivedAt: null,
          ...(onlyDueOnOrTags
            ? {}
            : {
                status: {
                  in: [TaskStatus.DRAFT, TaskStatus.QUEUED, TaskStatus.READY],
                },
              }),
        },
        data: {
          ...(name !== undefined && { name }),
          ...(editsTags ? { updatedAt: new Date() } : {}),
          ...(dismissedTopicIds?.length
            ? dismissTaskTopics(task, dismissedTopicIds)
            : {}),
          ...(nextDescription !== undefined && {
            description: nextDescription,
          }),
          ...(projectId !== undefined && { projectId }),
          ...(priority !== undefined && { priority }),
          ...(assigneeWrite ?? {}),
          ...(runAtWrite !== undefined && { runAt: runAtWrite }),
          ...(dueOnWrite !== undefined && { dueOn: dueOnWrite }),
          ...(nextStatus !== task.status ? { status: nextStatus } : {}),
        },
        include: buildTaskIncludeForViewer(
          authContext,
          task.workspaceId,
          c.var.workspaceContext?.workspaceId,
        ),
      });
      if (dueOnWrite !== undefined) {
        await recordTaskDueDateMovedLater(tx, {
          taskId: id,
          from: task.dueOn,
          to: dueOnWrite,
          actorUserId: userContext.userId,
        });
      }
      let parkedEventId: string | undefined;
      if (nextStatus !== task.status) {
        const statusEvent = await tx.taskEvent.create({
          data: {
            taskId: id,
            status: nextStatus,
            channel: Channel.SOKOSUMI,
            // Core parks the Task, so the event has no actor and the Owner
            // is told even when they made the assignment.
            ...(parksForInstructions
              ? {
                  comment: reopenedWithoutInstructionsComment(
                    updatedTask.assignee?.name ??
                      updatedTask.assigneeSokoBot?.name ??
                      "the assignee",
                  ),
                }
              : resolveTaskEventActorFields(authContext)),
          },
          include: taskEventApiInclude,
        });
        if (parksForInstructions) parkedEventId = statusEvent.id;
        updatedTask = {
          ...updatedTask,
          events: [...updatedTask.events, statusEvent],
        };
      }
      return {
        task: updatedTask,
        previousAssigneeUserId,
        workspaceId: task.workspaceId,
        statusChanged: nextStatus !== task.status,
        parkedEventId,
      };
    }, "Task changed during update");
    await deliverCalendarInvalidationsNow(result.workspaceId);
    // Same signal as POST /tasks/{id}/events: open boards refresh on it.
    // A Run at time move stays Queued, so it does not publish.
    const ownerId = result.task.ownerId;
    if ((result.statusChanged || editsTags) && ownerId) {
      try {
        await publishTaskEventData({
          userId: ownerId,
          taskId: result.task.id,
          eventType: "task_event",
        });
      } catch (error) {
        Sentry.captureException(error, {
          tags: { error_type: "publish_task_event" },
          extra: {
            taskId: result.task.id,
            userId: ownerId,
          },
        });
      }
    }

    const parkedEventId = result.parkedEventId;
    if (parkedEventId) {
      waitUntil(
        runAsBackgroundWork(() =>
          notifyTaskStatusEvent(
            result.task.id,
            parkedEventId,
            TaskStatus.INPUT_REQUIRED,
            null,
          ),
        ),
      );
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

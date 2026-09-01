import { createRoute, z } from "@hono/zod-openapi";
import { isTaskEditableStatus } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { requireMutableTaskOwnership } from "@/helpers/access-control";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { conflict, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { ok } from "@/helpers/response";
import { mapTask, validateTaskAssigneeAssignment } from "@/helpers/task";
import { refineTaskAssigneeXorConflict } from "@/helpers/task-assignee";
import {
  refineAssigneeIdAliasConflict,
  resolveAssigneeIdFromRequest,
} from "@/helpers/task-assignee-alias";
import { refreshTaskSchedulePlannedOccurrences } from "@/helpers/task-schedule-occurrence-index";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import { updateTaskForActor } from "@/services/task-domain.service";
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
    assigneeOrchestratorId: z.string().uuid().nullish().openapi({
      example: "01960001-0001-7001-8001-000000000099",
      description: "Owner PA orchestrator assignee. XOR with assigneeId.",
    }),
    /** @deprecated Use `assigneeId`. */
    coworkerId: z.string().nullish().openapi({
      example: "cow_123",
      deprecated: true,
      description: "Deprecated. Use assigneeId instead.",
    }),
  })
  .superRefine((data, ctx) => {
    refineAssigneeIdAliasConflict(data, ctx);
    refineTaskAssigneeXorConflict(data, ctx);

    if (
      data.name === undefined &&
      data.description === undefined &&
      data.projectId === undefined &&
      data.assigneeId === undefined &&
      data.coworkerId === undefined &&
      data.assigneeOrchestratorId === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "At least one of name, description, projectId, assigneeId, or assigneeOrchestratorId is required",
        path: ["name"],
      });
    }
  })
  .transform((data) => {
    const { coworkerId: _coworkerId, ...rest } = data;
    const assigneeId = resolveAssigneeIdFromRequest(data);
    const assigneeFieldsProvided =
      data.assigneeId !== undefined ||
      data.coworkerId !== undefined ||
      data.assigneeOrchestratorId !== undefined;
    return {
      ...rest,
      ...(assigneeFieldsProvided
        ? {
            assigneeId,
            assigneeOrchestratorId: data.assigneeOrchestratorId,
          }
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
    const { name, description, projectId, assigneeId, assigneeOrchestratorId } =
      c.req.valid("json");

    const task = await prisma.$transaction(async (tx) => {
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

      const assigneeFieldsProvided =
        assigneeId !== undefined || assigneeOrchestratorId !== undefined;
      const nextAssigneeId = assigneeFieldsProvided
        ? (assigneeId ?? null)
        : task.assigneeId;
      const nextAssigneeOrchestratorId = assigneeFieldsProvided
        ? (assigneeOrchestratorId ?? null)
        : task.assigneeOrchestratorId;
      validateTaskAssigneeAssignment({
        status: task.status,
        assigneeId: nextAssigneeId,
        assigneeOrchestratorId: nextAssigneeOrchestratorId,
      });

      const updatedTaskRow = await updateTaskForActor(
        {
          actor: { kind: "user", userId: userContext.userId },
          ownerId: userContext.userId,
          taskId: id,
          intent: "metadata",
          name,
          description,
          projectId,
          ...(assigneeFieldsProvided
            ? { assigneeId, assigneeOrchestratorId }
            : {}),
        },
        tx,
      );
      const updatedTask = await tx.task.findUniqueOrThrow({
        where: { id: updatedTaskRow.id },
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
      return updatedTask;
    });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

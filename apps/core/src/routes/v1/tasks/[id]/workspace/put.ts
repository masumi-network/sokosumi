import { createRoute, z } from "@hono/zod-openapi";
import {
  requireMutableTaskOwnership,
  requireTaskAssignableCoworker,
} from "@/helpers/access-control";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { resolveWorkspaceForContextOrNotFound } from "@/helpers/personal-workspace-error";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import { requireTaskAssignableOrchestrator } from "@/helpers/task-assignee";
import { refreshTaskSchedulePlannedOccurrences } from "@/helpers/task-schedule-occurrence-index";
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

export const putTaskWorkspaceRequestSchema = z.object({
  organizationId: z.string().min(1).nullable().openapi({ example: "org_123" }),
});

const route = createRoute({
  method: "put",
  path: "/{id}/workspace",
  description: "Change task workspace",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: putTaskWorkspaceRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Change task workspace"),
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
    const { organizationId: targetOrganizationId } = c.req.valid("json");

    const task = await serializableTransaction(async (tx) => {
      const ownedTask = await requireMutableTaskOwnership(userContext, id, tx);

      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: ownedTask.workspaceId },
        select: { organizationId: true },
      });

      const workspaceChanged =
        targetOrganizationId !== workspace.organizationId;

      if (!workspaceChanged) {
        return await tx.task.findUniqueOrThrow({
          where: { id },
          include: buildTaskIncludeForViewer(
            authContext,
            ownedTask.workspaceId,
          ),
        });
      }

      // `null` targets the authenticated user's personal workspace.
      if (targetOrganizationId !== null) {
        await resolveMemberOrganizationById({
          id: targetOrganizationId,
          userId: userContext.userId,
          tx,
        });
      }

      const targetWorkspace = await resolveWorkspaceForContextOrNotFound(
        userContext.userId,
        targetOrganizationId ?? null,
        tx,
      );

      const calendarScopes = [
        {
          workspaceId: ownedTask.workspaceId,
          projectIds: [ownedTask.projectId],
        },
        {
          workspaceId: targetWorkspace.id,
          projectIds: [],
        },
      ].sort((left, right) =>
        left.workspaceId.localeCompare(right.workspaceId),
      );
      for (const scope of calendarScopes) {
        if (
          !(await lockCalendarScope(tx, scope.workspaceId, scope.projectIds))
        ) {
          throw conflict("Task Calendar source changed during workspace move");
        }
      }
      if (!(await lockTaskRows(tx, [ownedTask.id]))) {
        throw conflict("Task changed during workspace move");
      }

      const existingLink = await tx.taskLink.findFirst({
        where: {
          OR: [{ fromTaskId: id }, { toTaskId: id }],
        },
        select: {
          id: true,
        },
      });

      if (existingLink) {
        throw conflict(
          "Cannot move a task with related tasks. Remove its links first.",
        );
      }

      // Pilot isolation: assignee must be usable in the target workspace
      // (global whitelist OR GRANTED early access). Blocks smuggling a
      // workspace-scoped coworker into another workspace via move.
      if (ownedTask.assigneeId) {
        await requireTaskAssignableCoworker(
          ownedTask.assigneeId,
          targetWorkspace.id,
          tx,
        );
      }

      if (ownedTask.assigneeOrchestratorId) {
        await requireTaskAssignableOrchestrator(
          ownedTask.assigneeOrchestratorId,
          targetWorkspace.id,
          tx,
          { kind: "user", userId: userContext.userId },
        );
      }

      await tx.task.update({
        where: {
          id,
        },
        data: {
          workspaceId: targetWorkspace.id,
          projectId: null,
        },
      });

      await tx.job.updateMany({
        where: { taskId: id },
        data: {
          workspaceId: targetWorkspace.id,
          projectId: null,
        },
      });
      await refreshTaskSchedulePlannedOccurrences(tx, {
        id: ownedTask.id,
        workspaceId: targetWorkspace.id,
        projectId: null,
        status: ownedTask.status,
        metadata: ownedTask.metadata,
        nextRunAt: ownedTask.nextRunAt,
      });

      return await tx.task.findUniqueOrThrow({
        where: { id },
        include: buildTaskIncludeForViewer(authContext, targetWorkspace.id),
      });
    }, "Task changed by a concurrent request. Please retry.");

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

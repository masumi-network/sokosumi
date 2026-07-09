import { createRoute, z } from "@hono/zod-openapi";
import { workspaceRepository } from "@sokosumi/database/repositories";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import { requireTaskNotParked } from "@/helpers/vendor-grants";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
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
    const userContext = requireUserContext(authContext);
    const { id } = c.req.valid("param");
    const { organizationId: targetOrganizationId } = c.req.valid("json");

    const task = await serializableTransaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: {
          id,
          userId: userContext.userId,
          archivedAt: null,
        },
        select: {
          pendingVendorGrantId: true,
          workspaceId: true,
          workspace: {
            select: {
              organizationId: true,
            },
          },
        },
      });

      if (!task) {
        throw notFound("Task not found");
      }

      requireTaskNotParked(task);

      const workspaceChanged =
        targetOrganizationId !== task.workspace.organizationId;

      if (!workspaceChanged) {
        return await tx.task.findUniqueOrThrow({
          where: { id },
          include: buildTaskIncludeForViewer(authContext, task.workspaceId),
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

      const workspace = await workspaceRepository.upsertWorkspaceForContext(
        userContext.userId,
        targetOrganizationId ?? null,
        tx,
      );

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

      await tx.task.update({
        where: {
          id,
        },
        data: {
          workspaceId: workspace.id,
          projectId: null,
        },
      });

      await tx.job.updateMany({
        where: { taskId: id },
        data: {
          workspaceId: workspace.id,
          projectId: null,
        },
      });

      return await tx.task.findUniqueOrThrow({
        where: { id },
        include: buildTaskIncludeForViewer(authContext, workspace.id),
      });
    }, "Task changed by a concurrent request. Please retry.");

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

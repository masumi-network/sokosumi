import { createRoute, z } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";
import { resolveWorkspaceForContext } from "@sokosumi/database/helpers";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  requireUserAuthContext,
  type WorkspaceContext,
} from "@/middleware/auth";
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
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { organizationId: targetOrganizationId } = c.req.valid("json");

    const task = await prisma.$transaction(
      async (tx) => {
        const viewerContext = c.var.workspaceContext ?? authContext;

        const task = await tx.task.findFirst({
          where: {
            id,
            userId: authContext.userId,
            archivedAt: null,
          },
          select: {
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

        const workspaceChanged =
          targetOrganizationId !== task.workspace.organizationId;

        if (!workspaceChanged) {
          return await tx.task.findUniqueOrThrow({
            where: { id },
            include: await buildTaskIncludeForViewer(viewerContext, tx),
          });
        }

        // `null` targets the authenticated user's personal workspace.
        if (targetOrganizationId !== null) {
          await resolveMemberOrganizationById({
            id: targetOrganizationId,
            userId: authContext.userId,
            tx,
          });
        }

        const workspace = await resolveWorkspaceForContext(
          authContext.userId,
          targetOrganizationId,
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
          },
        });

        await tx.job.updateMany({
          where: { taskId: id },
          data: {
            workspaceId: workspace.id,
          },
        });

        const postMoveViewerContext: WorkspaceContext = {
          workspaceId: workspace.id,
          userId: authContext.userId,
          organizationId: targetOrganizationId,
        };

        return await tx.task.findUniqueOrThrow({
          where: { id },
          include: await buildTaskIncludeForViewer(postMoveViewerContext, tx),
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

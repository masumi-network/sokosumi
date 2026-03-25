import { createRoute, z } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";

import { requireUserTaskAccess } from "@/helpers/access-control";
import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import { taskInclude } from "@/types/task";

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
    const { organizationId } = c.req.valid("json");

    const task = await prisma.$transaction(
      async (tx) => {
        const task = await requireUserTaskAccess(authContext, id, tx);
        const workspaceChanged = organizationId !== task.organizationId;

        if (!workspaceChanged) {
          return await tx.task.findUniqueOrThrow({
            where: { id },
            include: taskInclude,
          });
        }

        const existingJobsCount = await tx.job.count({
          where: { taskId: id },
        });
        if (existingJobsCount > 0) {
          throw conflict(
            "You can only change workspace before the task has any jobs",
          );
        }

        const taskEventsWithTransactionCount = await tx.taskEvent.count({
          where: {
            taskId: id,
            transactionId: { not: null },
          },
        });
        const hasLinkedTransactionEvent = taskEventsWithTransactionCount > 0;
        if (hasLinkedTransactionEvent) {
          throw conflict(
            "You can only change workspace before the task has events linked to a transaction",
          );
        }

        if (organizationId !== null) {
          await resolveMemberOrganizationById({
            id: organizationId,
            userId: authContext.userId,
            tx,
          });
        }

        const updateResult = await tx.task.updateMany({
          where: {
            id,
            userId: authContext.userId,
            organizationId: authContext.organizationId,
            archivedAt: null,
            status: task.status,
          },
          data: {
            organizationId,
          },
        });
        if (updateResult.count !== 1) {
          throw conflict("Task status was changed by another request");
        }

        return await tx.task.findUniqueOrThrow({
          where: { id },
          include: taskInclude,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

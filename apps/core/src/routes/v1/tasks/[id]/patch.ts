import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { isTaskEditableStatus } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import {
  requireMutableTaskOwnership,
  requireTaskAssignableCoworker,
} from "@/helpers/access-control";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask, validateTaskAssigneeAssignment } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
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
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.projectId !== undefined ||
      data.assigneeId !== undefined,
    {
      message:
        "At least one of name, description, projectId or assigneeId is required",
      path: ["name", "description", "projectId", "assigneeId"],
    },
  );

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
    const userContext = requireUserContext(authContext);
    const { id } = c.req.valid("param");
    const { name, description, projectId, assigneeId } = c.req.valid("json");

    const task = await prisma.$transaction(async (tx) => {
      const task = await requireMutableTaskOwnership(userContext, id, tx);

      if (!isTaskEditableStatus(task.status)) {
        throw forbidden("You can only update draft, queued, or ready tasks");
      }

      const assigneeIdWasProvided = assigneeId !== undefined;
      const nextAssigneeId = assigneeIdWasProvided
        ? assigneeId
        : task.assigneeId;
      validateTaskAssigneeAssignment({
        status: task.status,
        assigneeId: nextAssigneeId,
      });

      if (assigneeIdWasProvided && assigneeId !== null) {
        await requireTaskAssignableCoworker(assigneeId, tx);
      }

      const projectIdWasProvided = projectId !== undefined;
      if (projectIdWasProvided && projectId !== null) {
        const project = await tx.project.findFirst({
          where: {
            id: projectId,
            workspaceId: task.workspaceId,
          },
          select: { id: true },
        });

        if (!project) {
          throw notFound("Project not found");
        }
      }

      return tx.task.update({
        where: {
          id,
          ownerId: userContext.userId,
          status: {
            in: [TaskStatus.DRAFT, TaskStatus.QUEUED, TaskStatus.READY],
          },
        },
        data: {
          name,
          description,
          projectId,
          assigneeId,
        },
        include: buildTaskIncludeForViewer(authContext, task.workspaceId),
      });
    });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

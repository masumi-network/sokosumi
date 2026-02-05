import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { requireUserTaskAccess } from "@/helpers/access-control";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskSchema } from "@/schemas/task.schema";
import { taskInclude } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

export const patchTaskRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional().openapi({
      example: "Updated task title",
    }),
    description: z.string().nullish().openapi({
      example: "Updated description",
    }),
    coworkerId: z.string().nullish().openapi({ example: "cow_123" }),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.coworkerId !== undefined,
    {
      message: "At least one of name, description or coworkerId is required",
      path: ["name", "description", "coworkerId"],
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
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const task = await prisma.$transaction(async (tx) => {
      const task = await requireUserTaskAccess(authContext, id, tx);

      if (
        task.status !== TaskStatus.DRAFT &&
        task.status !== TaskStatus.READY
      ) {
        throw forbidden("You can only update draft or ready tasks");
      }

      return tx.task.update({
        where: {
          id,
          userId: authContext.userId,
          status: { in: [TaskStatus.DRAFT, TaskStatus.READY] },
        },
        data: {
          name: body.name,
          description: body.description,
          coworkerId: body.coworkerId,
        },
        include: taskInclude,
      });
    });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

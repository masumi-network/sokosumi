import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { requireTaskAccess } from "@/helpers/access-control";
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

export const updateTaskRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional().openapi({
      example: "Updated task title",
    }),
    description: z.string().nullish().optional().openapi({
      example: "Updated description",
    }),
    orchestratorId: z
      .string()
      .nullish()
      .optional()
      .openapi({ example: "orc_123" }),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.orchestratorId !== undefined,
    {
      message: "At least one field must be provided",
      path: ["name", "description", "orchestratorId"],
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
          schema: updateTaskRequestSchema,
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

function buildUpdateData(body: z.infer<typeof updateTaskRequestSchema>) {
  return {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.orchestratorId !== undefined && {
      orchestratorId: body.orchestratorId,
    }),
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const task = await prisma.$transaction(async (tx) => {
      const taskResult = await requireTaskAccess(authContext, id, tx);
      if (
        taskResult.status !== TaskStatus.DRAFT &&
        taskResult.status !== TaskStatus.READY
      ) {
        throw forbidden("You can only update draft or ready tasks");
      }
      
      return tx.task.update({
        where: { id },
        data: buildUpdateData(body),
        include: taskInclude,
      }); 
    });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}

import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskSchema } from "@/schemas/task.schema";
import { taskInclude } from "@/types/task";

export const createTaskRequestSchema = z.object({
  name: z.string().min(1).max(120).openapi({ example: "Review onboarding" }),
  description: z.string().nullish().openapi({ example: "Notes go here" }),
  orchestratorId: z.string().nullish().openapi({ example: "orc_123" }),
  status: z
    .enum([TaskStatus.DRAFT, TaskStatus.READY])
    .optional()
    .default(TaskStatus.DRAFT)
    .openapi({ example: TaskStatus.READY }),
});

const route = createRoute({
  method: "post",
  path: "/",
  description: "Create task",
  tags: ["Tasks"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createTaskRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(taskSchema, "Create task"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const body = c.req.valid("json");

    if (authContext.orchestratorId) {
      throw forbidden(
        "An orchestrator cannot create tasks. Please use the users authToken to create tasks.",
      );
    }

    const task = await prisma.$transaction(async (tx) => {
      return tx.task.create({
        data: {
          userId: authContext.userId,
          name: body.name,
          description: body.description ?? null,
          orchestratorId: body.orchestratorId ?? null,
          status: body.status,
          events: {
            create: {
              status: body.status,
              comment: null,
              userId: authContext.userId,
              orchestratorId: null,
            },
          },
        },
        include: taskInclude,
      });
    });

    return created(c, taskSchema.parse(mapTask(task)));
  });
}

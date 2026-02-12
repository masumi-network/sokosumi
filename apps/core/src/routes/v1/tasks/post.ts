import { createRoute, z } from "@hono/zod-openapi";
import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";

import { requireCoworkerExists } from "@/helpers/access-control";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { mapTask, validateTaskCoworkerAssignment } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { taskSchema } from "@/schemas/task.schema";
import { taskInclude } from "@/types/task";

export const createTaskRequestSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: "Review onboarding" }),
    description: z.string().nullish().openapi({ example: "Notes go here" }),
    coworkerId: z.string().nullish().openapi({ example: "cow_123" }),
    status: z
      .enum([TaskStatus.DRAFT, TaskStatus.READY])
      .optional()
      .default(TaskStatus.DRAFT)
      .openapi({ example: TaskStatus.READY }),
    origin: z
      .enum(TaskEventOrigin)
      .optional()
      .default(TaskEventOrigin.SOKOSUMI)
      .openapi({
        example: TaskEventOrigin.SLACK,
        description:
          "Origin of the initial task event. Defaults to SOKOSUMI if not provided.",
      }),
  })
  .superRefine((data, ctx) => {
    const hasCoworkerId =
      data.coworkerId !== null && data.coworkerId !== undefined;

    if (data.status !== TaskStatus.DRAFT && !hasCoworkerId) {
      ctx.addIssue({
        code: "custom",
        message: "coworkerId is required when creating a non-draft task",
        path: ["coworkerId"],
      });
    }
  });

const route = withGlobalHeaderParameters(
  createRoute({
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
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const body = c.req.valid("json");

    if (authContext.coworkerId) {
      throw forbidden(
        "A coworker cannot create tasks. Please use the users authToken to create tasks.",
      );
    }

    const task = await prisma.$transaction(async (tx) => {
      validateTaskCoworkerAssignment({
        status: body.status,
        coworkerId: body.coworkerId,
      });

      if (body.coworkerId !== null && body.coworkerId !== undefined) {
        await requireCoworkerExists(body.coworkerId, tx);
      }

      return tx.task.create({
        data: {
          userId: authContext.userId,
          organizationId: authContext.organizationId,
          name: body.name,
          description: body.description ?? null,
          coworkerId: body.coworkerId ?? null,
          status: body.status,
          events: {
            create: {
              status: body.status,
              comment: null,
              origin: body.origin,
              userId: authContext.userId,
              coworkerId: null,
            },
          },
        },
        include: taskInclude,
      });
    });

    return created(c, taskSchema.parse(mapTask(task)));
  });
}

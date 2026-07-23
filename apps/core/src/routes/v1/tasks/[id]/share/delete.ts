import { createRoute, z } from "@hono/zod-openapi";
import { publicShareRepository } from "@sokosumi/database/repositories";

import { requireMutableTaskOwnership } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { forbidCoworkerActor, requireUserContext } from "@/middleware/auth";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const deleteTaskShareResponseSchema = z.object({});

const route = createRoute({
  method: "delete",
  path: "/{id}/share",
  description: "Delete the public share for a task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      deleteTaskShareResponseSchema,
      "Delete a task share",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    forbidCoworkerActor(authContext);
    const userContext = requireUserContext(authContext);
    const { id } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      await requireMutableTaskOwnership(userContext, id, tx);
      await publicShareRepository.deleteByTaskId(id, tx);
    });

    return ok(c, deleteTaskShareResponseSchema.parse({}));
  });
}

import { createRoute, z } from "@hono/zod-openapi";
import { publicShareRepository } from "@sokosumi/database/repositories";

import { requireMutableTaskOwnership } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { putTaskShareRequestSchema } from "@/schemas/public-share.schema.js";
import { taskShareSchema } from "@/schemas/share.schema.js";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "put",
  path: "/{id}/share",
  description: "Create or update the public share for a task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: putTaskShareRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(taskShareSchema, "Create or update a task share"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireOwnerUserContext(authContext);
    const { id } = c.req.valid("param");
    const { allowSearchIndexing } = c.req.valid("json");

    const share = await prisma.$transaction(async (tx) => {
      await requireMutableTaskOwnership(userContext, id, tx);

      return await publicShareRepository.upsertForTask(
        id,
        allowSearchIndexing,
        tx,
      );
    });

    return ok(c, taskShareSchema.parse(share));
  });
}

import { createRoute, z } from "@hono/zod-openapi";

import { requireOrchestratorAccess } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  orchestratorSchema,
  updateOrchestratorRequestSchema,
} from "@/schemas/task-manager.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "orc_123",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/orchestrators/{id}",
  description: "Update orchestrator",
  tags: ["Task Manager"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateOrchestratorRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(orchestratorSchema, "Update orchestrator"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

function buildUpdateData(body: z.infer<typeof updateOrchestratorRequestSchema>) {
  return {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.url !== undefined && { url: body.url }),
    ...(body.email !== undefined && { email: body.email }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.image !== undefined && { image: body.image }),
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const orchestrator = await prisma.$transaction(async (tx) => {
      await requireOrchestratorAccess(authContext, id, tx);
      return tx.orchestrator.update({
        where: { id },
        data: buildUpdateData(body),
      });
    });

    if (!orchestrator) {
      throw notFound("Orchestrator not found");
    }

    return ok(c, orchestratorSchema.parse(orchestrator));
  });
}

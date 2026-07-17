import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { mapOrchestrator } from "@/helpers/orchestrator";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { orchestratorSchema } from "@/schemas/orchestrator.schema";

import { paramsSchema } from "../schema";

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: "Get orchestrator by id (admin only)",
  tags: ["Orchestrators"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(orchestratorSchema, "Retrieve orchestrator"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const orchestrator = await prisma.orchestrator.findFirst({
      where: { id },
    });

    if (!orchestrator) {
      throw notFound("Orchestrator not found");
    }

    return ok(c, mapOrchestrator(orchestrator));
  });
}

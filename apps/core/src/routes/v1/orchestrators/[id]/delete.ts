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
  method: "delete",
  path: "/{id}",
  description: "Archive orchestrator and revoke active API keys (admin only)",
  tags: ["Orchestrators"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(orchestratorSchema, "Archive orchestrator"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const orchestrator = await prisma.$transaction(async (tx) => {
      const archivedAt = new Date();

      const archiveResult = await tx.orchestrator.updateMany({
        where: {
          id,
          archivedAt: null,
        },
        data: {
          archivedAt,
        },
      });

      if (archiveResult.count === 0) {
        throw notFound("Orchestrator not found");
      }

      await tx.orchestratorApiKey.updateMany({
        where: {
          orchestratorId: id,
          revokedAt: null,
        },
        data: {
          revokedAt: archivedAt,
        },
      });

      const archived = await tx.orchestrator.findFirst({
        where: { id },
      });

      if (!archived) {
        throw notFound("Orchestrator not found");
      }

      return archived;
    });

    return ok(c, mapOrchestrator(orchestrator));
  });
}

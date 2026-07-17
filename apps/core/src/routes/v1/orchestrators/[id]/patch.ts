import { createRoute } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { mapOrchestrator } from "@/helpers/orchestrator";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { orchestratorSchema } from "@/schemas/orchestrator.schema";

import { paramsSchema, patchOrchestratorRequestSchema } from "../schema";

const route = createRoute({
  method: "patch",
  path: "/{id}",
  description: "Update orchestrator (admin only)",
  tags: ["Orchestrators"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: patchOrchestratorRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(orchestratorSchema, "Update orchestrator"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      const updatedCount = await prisma.orchestrator.updateMany({
        where: {
          id,
          archivedAt: null,
        },
        data: {
          name: body.name,
          slug: body.slug,
          caption: body.caption,
          description: body.description,
        },
      });

      if (updatedCount.count === 0) {
        throw notFound("Orchestrator not found");
      }

      const orchestrator = await prisma.orchestrator.findFirst({
        where: { id },
      });

      if (!orchestrator) {
        throw notFound("Orchestrator not found");
      }

      return ok(c, mapOrchestrator(orchestrator));
    } catch (error) {
      if (isSlugUniqueConstraintError(error)) {
        throw conflict(
          "Orchestrator slug already exists. Please choose a different slug.",
        );
      }
      throw error;
    }
  });
}

import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { mapOrchestrator } from "@/helpers/orchestrator";
import { ok } from "@/helpers/response";
import { deleteOrchestratorImageIfOwned } from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { orchestratorSchema } from "@/schemas/orchestrator.schema";

import { paramsSchema } from "../../schema";

const route = createRoute({
  method: "delete",
  path: "/{id}/image",
  description:
    "Remove the orchestrator image (admin only). Clears orchestrator.image and deletes the previous owned blob when present.",
  tags: ["Orchestrators"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(orchestratorSchema, "Remove orchestrator image"),
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
      where: {
        id,
        archivedAt: null,
      },
    });

    if (!orchestrator) {
      throw notFound("Orchestrator not found");
    }

    const previousImage = orchestrator.image;

    // Atomic with archivedAt so a concurrent archive cannot clear image on an
    // archived row (matches PATCH /orchestrators/{id}).
    const updateResult = await prisma.orchestrator.updateMany({
      where: {
        id,
        archivedAt: null,
      },
      data: { image: null },
    });

    if (updateResult.count === 0) {
      throw notFound("Orchestrator not found");
    }

    const updated = await prisma.orchestrator.findFirst({
      where: { id },
    });

    if (!updated) {
      throw notFound("Orchestrator not found");
    }

    await deleteOrchestratorImageIfOwned(previousImage, id);

    return ok(c, mapOrchestrator(updated));
  });
}

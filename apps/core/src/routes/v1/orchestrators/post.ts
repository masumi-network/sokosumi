import { createRoute } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { mapOrchestrator } from "@/helpers/orchestrator";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { orchestratorSchema } from "@/schemas/orchestrator.schema";

import { createOrchestratorRequestSchema } from "./schema";

const route = createRoute({
  method: "post",
  path: "/",
  description: "Create orchestrator (admin only)",
  tags: ["Orchestrators"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createOrchestratorRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(orchestratorSchema, "Create orchestrator"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const body = c.req.valid("json");

    try {
      const orchestrator = await prisma.orchestrator.create({
        data: {
          slug: body.slug,
          name: body.name,
          caption: body.caption ?? null,
          description: body.description ?? null,
        },
      });

      return created(c, mapOrchestrator(orchestrator));
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

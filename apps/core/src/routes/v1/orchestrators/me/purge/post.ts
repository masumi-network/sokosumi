import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { archiveOrchestratorForUser } from "@/helpers/orchestrator-instance";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOrchestratorAuthContext } from "@/middleware/auth";

const purgeRequestSchema = z
  .object({
    userId: z.string().min(1).openapi({ example: "user_123" }),
  })
  .strict()
  .openapi("OrchestratorPurgeRequest");

const purgeResponseSchema = z
  .object({
    purged: z.literal(true),
    userId: z.string(),
  })
  .openapi("OrchestratorPurgeResponse");

const route = createRoute({
  method: "post",
  path: "/me/purge",
  description:
    "Purge local Hermes mirror for the user in the body (orchestrator service only). Archives the per-user orchestrator row; does not hard-delete it.",
  tags: ["Orchestrators"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: purgeRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      purgeResponseSchema,
      "local assistant state purged",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

/**
 * Wipe Sokosumi's per-user Hermes mirror: chat history, pending OAuth claims,
 * and archive the orchestrator instance (poll cursors cleared). Idempotent.
 */
async function clearHermesLocalMirror(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.hermesMessage.deleteMany({ where: { userId } });
    await tx.hermesPendingConnection.deleteMany({ where: { userId } });
    await archiveOrchestratorForUser(userId, tx);
  });
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireOrchestratorAuthContext(c.var.authContext);
    const { userId } = c.req.valid("json");

    await clearHermesLocalMirror(userId);

    return ok(c, { purged: true as const, userId });
  });
}

import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";

import { serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { clearHermesLocalMirrorForUser } from "@/helpers/orchestrator-instance";
import { ok } from "@/helpers/response";
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
    500: jsonErrorResponse("Internal Server Error"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireOrchestratorAuthContext(c.var.authContext);
    const { userId } = c.req.valid("json");

    try {
      await clearHermesLocalMirrorForUser(userId);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { context: "orchestrator_purge" },
        extra: { userId },
      });
      throw serviceUnavailable(
        "Failed to purge local assistant state. Retrying is safe.",
      );
    }

    return ok(c, { purged: true as const, userId });
  });
}

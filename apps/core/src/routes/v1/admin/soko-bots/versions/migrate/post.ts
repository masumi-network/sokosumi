import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  adminSokoBotVersionMigrationRequestSchema,
  adminSokoBotVersionMigrationResultSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapError, traceIdFromTraceparent } from "../../helpers.js";

// Promotion only decides what new bots are created on. Moving the ones that
// already exist is this: every bot goes through the same audited admin action
// a single-bot move does, so the fleet migration is a set of per-bot records
// rather than one entry nobody can trace back.
const migrateVersionRoute = createRoute({
  method: "post",
  path: "/versions/migrate",
  operationId: "migrateAdminSokoBotVersions",
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: adminSokoBotVersionMigrationRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminSokoBotVersionMigrationResultSchema,
      "What the migration moved, skipped and could not move",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(migrateVersionRoute, async (c) => {
    const operator = requireAdminAuthContext(c.var.authContext);
    try {
      return ok(
        c,
        adminSokoBotVersionMigrationResultSchema.parse(
          await sokoBotControlPlane.migrateVersions({
            operatorId: operator.userId,
            ...c.req.valid("json"),
            requestId: c.var.requestId,
            traceId: traceIdFromTraceparent(c.req.header("traceparent")),
          }),
        ),
      );
    } catch (error) {
      mapError(error);
    }
  });
}

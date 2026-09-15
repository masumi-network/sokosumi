import { createRoute } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { auth } from "@/lib/auth";
import { auditImpersonationDenied, auditImpersonationStop } from "@/lib/evlog";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  isCoworkerAuthContext,
  isSokoBotAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import { adminUserOptionSchema } from "@/schemas/admin.schema";

import { forwardSessionCookies } from "./cookies.js";

const route = createRoute({
  method: "delete",
  path: "/",
  operationId: "stopAdminImpersonation",
  description:
    "Stop the current impersonation and restore the admin session via Set-Cookie. Callable only while impersonating (the caller holds the target's non-admin role, so this deliberately skips the admin-router guard). Audit-logs the stop.",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(adminUserOptionSchema, "The restored admin user", {
      data: {
        id: "user_123",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    400: jsonErrorResponse("Bad Request - not currently impersonating"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    let caller;
    try {
      caller = requireUserAuthContext(c.var.authContext);
    } catch (error) {
      const actorId = isCoworkerAuthContext(c.var.authContext)
        ? c.var.authContext.coworkerId
        : isSokoBotAuthContext(c.var.authContext)
          ? c.var.authContext.sokoBotId
          : "unknown";
      auditImpersonationDenied({
        action: "impersonation.stop",
        actorId,
        denial:
          error instanceof Error
            ? error.message
            : "User authentication required",
      });
      throw error;
    }
    const adminId = caller.impersonatedBy;
    if (!adminId) {
      auditImpersonationDenied({
        action: "impersonation.stop",
        actorId: caller.userId,
        denial: "Not currently impersonating a user",
      });
      throw badRequest("Not currently impersonating a user");
    }

    const { headers, response } = await auth.api.stopImpersonating({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    forwardSessionCookies(c, headers);

    auditImpersonationStop({
      adminId,
      targetUserId: caller.userId,
    });

    return ok(
      c,
      adminUserOptionSchema.parse({
        id: response.user.id,
        name: response.user.name,
        email: response.user.email,
      }),
    );
  });
}

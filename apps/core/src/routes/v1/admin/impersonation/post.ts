import { createRoute } from "@hono/zod-openapi";

import { conflict, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db/prisma";
import { auditImpersonationDenied, auditImpersonationStart } from "@/lib/evlog";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  hasAdminRole,
  isCoworkerAuthContext,
  isSokoBotAuthContext,
  requireInteractiveAdminAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  adminUserOptionSchema,
  startImpersonationBodySchema,
} from "@/schemas/admin.schema";

import { forwardSessionCookies } from "./cookies.js";

const route = createRoute({
  method: "post",
  path: "/",
  operationId: "startAdminImpersonation",
  description:
    "Start impersonating a non-admin user (admin only). Returns the target user and switches the browser session to them via Set-Cookie. Requires a reason, rejects nested impersonations with 409, and audit-logs the start. Sessions expire after one hour.",
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: startImpersonationBodySchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      adminUserOptionSchema,
      "The user now being impersonated",
      {
        data: {
          id: "user_123",
          name: "Ada Lovelace",
          email: "ada@example.com",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - admin access required or target is an admin",
    ),
    404: jsonErrorResponse("Not Found - target user does not exist"),
    409: jsonErrorResponse("Conflict - already impersonating a user"),
    422: jsonErrorResponse("Unprocessable Entity - validation failed"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Conflict before the admin check: an impersonated caller holds the
    // target's non-admin role, so the admin guard alone would answer 403 and
    // the "already impersonating" state would never surface as 409.
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
        action: "impersonation.start",
        actorId,
        denial:
          error instanceof Error
            ? error.message
            : "User authentication required",
      });
      throw error;
    }
    if (caller.impersonatedBy) {
      auditImpersonationDenied({
        action: "impersonation.start",
        actorId: caller.impersonatedBy,
        targetUserId: caller.userId,
        denial: "Already impersonating a user",
      });
      throw conflict(
        "Already impersonating a user. Stop the current impersonation first.",
      );
    }
    let admin;
    try {
      admin = requireInteractiveAdminAuthContext(c.var.authContext);
    } catch (error) {
      auditImpersonationDenied({
        action: "impersonation.start",
        actorId: caller.userId,
        denial:
          error instanceof Error
            ? error.message
            : "Interactive admin session required",
      });
      throw error;
    }

    const { userId, reason } = c.req.valid("json");

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!target) {
      auditImpersonationDenied({
        action: "impersonation.start",
        actorId: admin.userId,
        targetUserId: userId,
        denial: "User not found",
      });
      throw notFound("User not found");
    }
    if (hasAdminRole(target.role)) {
      auditImpersonationDenied({
        action: "impersonation.start",
        actorId: admin.userId,
        targetUserId: target.id,
        denial: "Admin users cannot be impersonated",
      });
      throw forbidden("Admin users cannot be impersonated");
    }

    // Better Auth APIErrors (unknown target, admin target, session problems)
    // propagate to the error handler, which maps their status into the
    // envelope. Our checks above make them rare races, not normal paths.
    const { headers } = await auth.api.impersonateUser({
      body: { userId: target.id },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    forwardSessionCookies(c, headers);

    auditImpersonationStart({
      adminId: admin.userId,
      targetUserId: target.id,
      reason,
    });

    return created(
      c,
      adminUserOptionSchema.parse({
        id: target.id,
        name: target.name,
        email: target.email,
      }),
    );
  });
}

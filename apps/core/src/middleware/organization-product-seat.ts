import { createMiddleware } from "hono/factory";

import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import type { EnvVariables } from "@/lib/hono";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  isUserAuthContext,
} from "@/middleware/auth";

export function resolveOrganizationProductSeatUser(
  authContext: AuthenticationContext,
): { organizationId: string; userId: string } | null {
  // The orchestrator actor was removed with Hermes; a coworker still has no
  // seat of its own.
  if (isCoworkerAuthContext(authContext)) {
    return null;
  }
  if (!isUserAuthContext(authContext)) {
    return null;
  }
  if (!authContext.organizationId) {
    return null;
  }
  return {
    organizationId: authContext.organizationId,
    userId: authContext.userId,
  };
}

export const organizationProductSeatMiddleware = createMiddleware<EnvVariables>(
  async (c, next) => {
    if (!c.var.isAuthenticated) {
      return await next();
    }

    const seatUser = resolveOrganizationProductSeatUser(c.var.authContext);
    if (!seatUser) {
      return await next();
    }

    await requireAssignedOrganizationSeat(
      seatUser.userId,
      seatUser.organizationId,
    );
    return await next();
  },
);

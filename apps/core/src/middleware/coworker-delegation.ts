import { createMiddleware } from "hono/factory";

import { badRequest } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  type AuthEnv,
  type CoworkerAuthenticationContext,
  isCoworkerAuthContext,
  setAuthContext,
} from "@/middleware/auth";

const HEADER_DELEGATION_USER_ID = "x-delegation-user-id";
const HEADER_DELEGATION_ORGANIZATION_ID = "x-delegation-organization-id";

/**
 * For coworker bearer authentication only: reads optional delegation headers and
 * attaches `delegation` to the auth context without changing `actor` from `"coworker"`.
 *
 * - If both headers are absent (or only whitespace), the request continues unchanged.
 * - `X-Delegation-Organization-Id` without `X-Delegation-User-Id` is rejected (400).
 * - When both delegation user and organization are set, the user must be a member of
 *   that organization (same rule as organization-scoped user routes); otherwise 400.
 * - This is intentionally broad for now: any coworker API key may delegate to any
 *   valid user/org pair. In practice this makes coworker API keys admin-like for
 *   delegated user routes until per-coworker delegation permissions are added.
 * - User auth and other actors are not modified by this middleware.
 *
 * Runs after {@link authMiddleware}. Further authorization (whether this coworker may
 * act for that user/org for a given operation) remains the responsibility of routes or helpers.
 *
 * TODO: Narrow this once we add a real coworker delegation permission model.
 */
export const coworkerDelegationMiddleware = createMiddleware<AuthEnv>(
  async (c, next) => {
    const { isAuthenticated, authContext } = c.var;

    if (!isAuthenticated || !isCoworkerAuthContext(authContext)) {
      return await next();
    }

    const userIdRaw = c.req.header(HEADER_DELEGATION_USER_ID);
    const organizationIdRaw = c.req.header(HEADER_DELEGATION_ORGANIZATION_ID);
    const userId = userIdRaw?.trim() ?? "";
    const organizationIdTrimmed = organizationIdRaw?.trim() ?? "";

    if (!userId && !organizationIdTrimmed) {
      return await next();
    }

    if (!userId) {
      throw badRequest(
        "X-Delegation-User-Id is required when X-Delegation-Organization-Id is set",
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw badRequest("Delegated user does not exist");
    }

    if (organizationIdTrimmed) {
      const member = await prisma.member.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId: organizationIdTrimmed,
          },
        },
        select: { userId: true },
      });

      if (!member) {
        throw badRequest("User is not a member of the specified organization");
      }
    }

    const nextContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: authContext.coworkerId,
      delegation: {
        userId,
        organizationId: organizationIdTrimmed ? organizationIdTrimmed : null,
      },
    };

    setAuthContext(c, {
      isAuthenticated,
      authContext: nextContext,
    });

    return await next();
  },
);

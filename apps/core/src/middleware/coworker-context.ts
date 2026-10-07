import { createMiddleware } from "hono/factory";

import { badRequest } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  type AuthEnv,
  isCoworkerAuthContext,
  setAuthContext,
} from "@/middleware/auth";
import { BEARER_USER_SELECT, isActiveUser } from "./auth-active-user";

const HEADER_CONTEXT_USER_ID = "x-context-user-id";
const HEADER_CONTEXT_ORGANIZATION_ID = "x-context-organization-id";

/**
 * For coworker bearer authentication: reads optional workspace
 * context headers and attaches `context` without changing `actor`.
 *
 * Headers: `X-Context-User-Id`, `X-Context-Organization-Id`.
 *
 * - If both headers are absent (or only whitespace), the request continues unchanged.
 * - Organization header without user header is rejected (400).
 * - The context user must exist and not be under an active ban (400). When an
 *   organization is set, they must be a member of that organization (400, same
 *   rule as organization-scoped user routes).
 *
 * Runs after {@link authMiddleware}.
 */
export const coworkerContextMiddleware = createMiddleware<AuthEnv>(
  async (c, next) => {
    const { isAuthenticated, authContext } = c.var;

    if (!isAuthenticated || !isCoworkerAuthContext(authContext)) {
      return await next();
    }

    const userId = c.req.header(HEADER_CONTEXT_USER_ID)?.trim() ?? "";
    const organizationIdTrimmed =
      c.req.header(HEADER_CONTEXT_ORGANIZATION_ID)?.trim() ?? "";

    if (!userId && !organizationIdTrimmed) {
      return await next();
    }

    if (!userId) {
      throw badRequest(
        "X-Context-User-Id is required when X-Context-Organization-Id is set",
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, ...BEARER_USER_SELECT },
    });

    // Missing, banned, and deleted all fail this predicate. Same message as a
    // missing row so a ban is not distinguishable from a typo.
    if (!isActiveUser(user)) {
      throw badRequest("Context user does not exist");
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

    const context = {
      userId,
      organizationId: organizationIdTrimmed ? organizationIdTrimmed : null,
    };

    setAuthContext(c, {
      isAuthenticated,
      authContext: {
        actor: "coworker",
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
        context,
      },
    });

    return await next();
  },
);

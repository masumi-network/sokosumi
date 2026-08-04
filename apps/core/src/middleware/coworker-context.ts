import { createMiddleware } from "hono/factory";

import { badRequest, forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  type AuthEnv,
  isCoworkerAuthContext,
  isOrchestratorAuthContext,
  type OrchestratorAuthenticationContext,
  setAuthContext,
} from "@/middleware/auth";
import { hasCoworkerUserDelegation } from "@/middleware/coworker-delegation";

const HEADER_CONTEXT_USER_ID = "x-context-user-id";
const HEADER_CONTEXT_ORGANIZATION_ID = "x-context-organization-id";
const HEADER_DELEGATION_USER_ID = "x-delegation-user-id";
const HEADER_DELEGATION_ORGANIZATION_ID = "x-delegation-organization-id";

function readContextHeaders(c: {
  req: { header: (name: string) => string | undefined };
}): { userId: string; organizationId: string } {
  const contextUserId = c.req.header(HEADER_CONTEXT_USER_ID)?.trim() ?? "";
  const contextOrganizationId =
    c.req.header(HEADER_CONTEXT_ORGANIZATION_ID)?.trim() ?? "";
  const delegationUserId =
    c.req.header(HEADER_DELEGATION_USER_ID)?.trim() ?? "";
  const delegationOrganizationId =
    c.req.header(HEADER_DELEGATION_ORGANIZATION_ID)?.trim() ?? "";

  const hasContextHeaders =
    contextUserId.length > 0 || contextOrganizationId.length > 0;

  if (hasContextHeaders) {
    return {
      userId: contextUserId,
      organizationId: contextOrganizationId,
    };
  }

  return {
    userId: delegationUserId,
    organizationId: delegationOrganizationId,
  };
}

/**
 * For coworker/orchestrator bearer authentication: reads optional workspace
 * context headers and attaches `context` without changing `actor`.
 *
 * Canonical headers: `X-Context-User-Id`, `X-Context-Organization-Id`.
 * Legacy `X-Delegation-*` headers are still accepted; when both are sent, context wins.
 *
 * - If both header pairs are absent (or only whitespace), the request continues unchanged.
 * - Organization header without user header is rejected (400).
 * - The context user must exist (400) and, when an organization is set, be a member
 *   of that organization (400, same rule as organization-scoped user routes).
 *
 * Runs after {@link authMiddleware}.
 */
export const coworkerContextMiddleware = createMiddleware<AuthEnv>(
  async (c, next) => {
    const { isAuthenticated, authContext } = c.var;

    if (
      !isAuthenticated ||
      (!isCoworkerAuthContext(authContext) &&
        !isOrchestratorAuthContext(authContext))
    ) {
      return await next();
    }

    const { userId, organizationId: organizationIdTrimmed } =
      readContextHeaders(c);

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
      select: { id: true },
    });

    if (!user) {
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

    if (isCoworkerAuthContext(authContext)) {
      // Existence of the context user is not authorization. A coworker key is
      // vendor-issued and the header is caller-chosen, so without this check
      // any vendor could name any user id and read/act as them on every route
      // that resolves the effective user via `requireUserContext`.
      // Orchestrator keys are exempt: that is a first-party service token, not
      // a third-party credential.
      const hasDelegation = await hasCoworkerUserDelegation({
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
        userId,
      });

      if (!hasDelegation) {
        throw forbidden(
          "Coworker is not delegated to act for the specified context user",
        );
      }

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
    }

    // Bind per-user orchestrator id from context user (active instance only).
    const orchestrator = await prisma.orchestrator.findFirst({
      where: { userId, archivedAt: null },
      select: { id: true },
    });

    const nextAuthContext: OrchestratorAuthenticationContext = {
      actor: "orchestrator",
      orchestratorId: orchestrator?.id,
      context,
    };

    setAuthContext(c, {
      isAuthenticated,
      authContext: nextAuthContext,
    });

    return await next();
  },
);

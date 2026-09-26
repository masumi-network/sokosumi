import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import { forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import {
  type AuthEnv,
  isUserAuthContext,
  setAuthContext,
} from "@/middleware/auth";

/**
 * Resolves organization ID from slug and verifies user membership.
 *
 * @param organizationSlug - The organization slug to look up
 * @param userId - The authenticated user's ID
 * @returns The organization ID if valid and user is a member
 * @throws {forbidden} If user is not a member of the organization
 */
async function resolveOrganizationFromSlug(
  organizationSlug: string,
  userId: string,
): Promise<string> {
  const membership = await prisma.member.findFirst({
    where: {
      userId,
      organization: {
        slug: organizationSlug,
      },
    },
    select: { organizationId: true },
  });

  if (!membership) {
    throw forbidden(
      `You are not a member of organization '${organizationSlug}'`,
    );
  }

  return membership.organizationId;
}

/**
 * Reports whether the user is still a member of the organization.
 */
async function hasOrganizationMembership(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const membership = await prisma.member.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId,
      },
    },
    select: { id: true },
  });

  return membership !== null;
}

/**
 * Switches the session to the personal workspace.
 *
 * A direct `session` row update would stay invisible for the lifetime of the
 * session cookie cache, so the switch goes through Better Auth, which writes
 * the row and re-signs the cookie.
 *
 * The session is read again with the cookie cache disabled before writing.
 * That read does two things: it skips a repeat write once the row is already
 * clear, and it leaves a deliberate switch to another organization alone,
 * because a request that started before that switch would otherwise write
 * `null` over it.
 *
 * The refreshed cookie is forwarded, but it reaches the browser only on a
 * browser-direct call. Web calls Core server side and does not relay
 * `Set-Cookie`, and a handler that returns a raw `Response` drops it too. The
 * caller's cached session therefore keeps naming the dead organization until
 * the cache expires, and this middleware drops the organization on every
 * request in the meantime. The row is written once; only the cookie lags.
 *
 * `@/lib/auth` is imported here rather than at module scope: this middleware
 * loads on every route, and pulling the auth module into that graph drags
 * Stripe and its startup checks into suites that never touch either.
 */
async function switchSessionToPersonalWorkspace(
  c: Context<AuthEnv>,
  staleOrganizationId: string,
): Promise<void> {
  try {
    const { auth } = await import("@/lib/auth");

    const stored = await auth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableCookieCache: true },
    });

    if (stored?.session.activeOrganizationId !== staleOrganizationId) {
      return;
    }

    const { headers } = await auth.api.setActiveOrganization({
      body: { organizationId: null },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });

    for (const cookie of headers.getSetCookie()) {
      c.header("set-cookie", cookie, { append: true });
    }
  } catch (error) {
    // The request still continues without the organization, so a failed
    // switch costs a repeat next request, not access to the organization.
    captureExternalServiceError(error, {
      label: "organization_context_session_switch",
      sentry: {
        tags: {
          context: "organization_context_session_switch",
        },
      },
    });
  }
}

/**
 * Middleware that establishes the organization for a user request.
 *
 * When the request already carries an organization (from the session), the
 * user's current membership of it is verified. A user who was removed from
 * that organization is switched to their personal workspace instead of being
 * served organization data. Otherwise the organization is resolved from the
 * `X-Organization-Slug` header, which rejects a caller who is not a member.
 *
 * This middleware should run after authMiddleware to ensure the user is authenticated.
 *
 * @example
 * ```typescript
 * app.use(authMiddleware);
 * app.use(organizationContextMiddleware);
 * ```
 */
export const organizationContextMiddleware = createMiddleware<AuthEnv>(
  async (c, next) => {
    const { authContext, isAuthenticated } = c.var;

    if (isAuthenticated && isUserAuthContext(authContext)) {
      if (authContext.organizationId) {
        const stillAMember = await hasOrganizationMembership(
          authContext.organizationId,
          authContext.userId,
        );

        if (!stillAMember) {
          await switchSessionToPersonalWorkspace(c, authContext.organizationId);
          setAuthContext(c, {
            isAuthenticated,
            authContext: {
              ...authContext,
              organizationId: null,
            },
          });
        }
      } else {
        const organizationSlug = c.req.header("x-organization-slug");

        if (organizationSlug) {
          const organizationId = await resolveOrganizationFromSlug(
            organizationSlug,
            authContext.userId,
          );
          setAuthContext(c, {
            isAuthenticated,
            authContext: {
              ...authContext,
              organizationId,
            },
          });
        }
      }
    }

    return await next();
  },
);

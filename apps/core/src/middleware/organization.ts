import { createMiddleware } from "hono/factory";

import { forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
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
 * Verifies that the user is still a member of the organization the request
 * already carries.
 *
 * The session keeps `activeOrganizationId` after a member is removed, and
 * Better Auth only clears it from the remover's own session. Request-time
 * membership is therefore the control, not session state.
 *
 * @throws {forbidden} If the user is not a member of the organization
 */
async function assertOrganizationMembership(
  organizationId: string,
  userId: string,
): Promise<void> {
  const membership = await prisma.member.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId,
      },
    },
    select: { id: true },
  });

  if (!membership) {
    throw forbidden("You are not a member of this organization");
  }
}

/**
 * Middleware that establishes the organization for a user request.
 *
 * When the request already carries an organization (from the session), the
 * user's current membership of it is verified. Otherwise the organization is
 * resolved from the `X-Organization-Slug` header, which also verifies
 * membership.
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
        await assertOrganizationMembership(
          authContext.organizationId,
          authContext.userId,
        );
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

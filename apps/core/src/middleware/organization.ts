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
 * Middleware that sets organizationId from X-Organization-Slug header,
 * but only if organizationId is currently null.
 *
 * This middleware should run after authMiddleware to ensure the user is authenticated.
 * It reads the X-Organization-Slug header and verifies the user is a member of that organization.
 *
 * @example
 * ```typescript
 * app.use(authMiddleware);
 * app.use(organizationHeaderMiddleware);
 * ```
 */
export const organizationHeaderMiddleware = (
  includeOrganizationHeader: boolean,
) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    if (!includeOrganizationHeader) {
      return await next();
    }

    const { authContext, isAuthenticated } = c.var;

    if (
      isAuthenticated &&
      isUserAuthContext(authContext) &&
      !authContext.organizationId
    ) {
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

    return await next();
  });

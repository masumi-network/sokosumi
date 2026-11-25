import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  isPersonSession,
  requirePersonApproval,
  type UserAuthenticationContext,
} from "@/middleware/auth";

/**
 * Where a person approves Coworker access and vendor grants for their
 * personal workspace (ADR 0077).
 */
export const ACCOUNT_WEB_PATH = "/account";

/** The person a credential acts for, if it names one. */
function personBehind(authContext: AuthenticationContext): string | null {
  if (authContext.actor === "coworker")
    return authContext.context?.userId ?? null;
  return authContext.userId;
}

/**
 * {@link requirePersonApproval} for an organization workspace. An agent is
 * sent to the organization's settings when its person is a member, else to
 * the active organization's settings, so the 403 never names an organization
 * the caller does not belong to. A browser session costs no lookup.
 */
export async function requireOrganizationPersonApproval(
  authContext: AuthenticationContext,
  organizationId: string,
): Promise<UserAuthenticationContext> {
  if (isPersonSession(authContext)) return authContext;

  const userId = personBehind(authContext);
  const organization = userId
    ? await prisma.organization.findFirst({
        where: { id: organizationId, members: { some: { userId } } },
        select: { slug: true },
      })
    : null;
  return requirePersonApproval(
    authContext,
    organization
      ? `/organizations/${encodeURIComponent(organization.slug)}`
      : "/organization",
  );
}

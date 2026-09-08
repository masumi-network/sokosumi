import { CALENDAR_BETA_ORGANIZATION_SLUG, isNmkrEmail } from "@sokosumi/utils";

interface CalendarBetaMembership {
  organization: { slug: string };
}

/**
 * Email domains allowed to use the Soko Bot beta.
 */
export function isSokoBotBetaAccessEmail(
  email: string | null | undefined,
): boolean {
  return isNmkrEmail(email);
}

export function hasCalendarBetaAccess(
  memberships: readonly CalendarBetaMembership[],
): boolean {
  return memberships.some(
    ({ organization }) => organization.slug === CALENDAR_BETA_ORGANIZATION_SLUG,
  );
}

/**
 * Beta access for Soko Bot. Signup does not require email verification and
 * signs the user straight in, so a whitelisted domain alone proves nothing:
 * anyone can register `someone@nmkr.io` without holding that mailbox. The
 * verified flag is what makes the domain check mean something.
 */
export function hasSokoBotBetaAccess(
  user: { email?: string | null; emailVerified?: boolean | null } | null,
): boolean {
  if (!user?.emailVerified) return false;
  return isSokoBotBetaAccessEmail(user.email);
}

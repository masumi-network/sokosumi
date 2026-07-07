export const BILLING_PORTAL_ERROR_PARAM = "billingPortalError";
export const BILLING_PORTAL_ERROR_GENERAL = "general";
export const BILLING_PORTAL_ERROR_UNAUTHORIZED = "unauthorized";

const ALLOWED_SEC_FETCH_SITE_VALUES = new Set([
  "same-origin",
  "same-site",
  "none",
]);

/**
 * Guards the portal route (a side-effecting GET that creates a Stripe portal
 * session) against cross-site requests. Only same-origin/same-site navigations
 * and top-level direct navigations (`none`) are allowed. A missing header is
 * rejected so non-browser clients replaying a stolen session cookie cannot
 * trigger session creation.
 */
export function isAllowedBillingPortalNavigation(
  secFetchSite: string | null,
): boolean {
  if (!secFetchSite) {
    return false;
  }

  return ALLOWED_SEC_FETCH_SITE_VALUES.has(secFetchSite);
}

/** Builds the internal redirect route used by "Manage in Stripe" links. */
export function buildBillingPortalRedirectPath({
  returnPath,
  organizationId,
}: {
  returnPath: string;
  organizationId?: string | null;
}): string {
  const params = new URLSearchParams({ returnPath });
  if (organizationId) {
    params.set("organizationId", organizationId);
  }

  return `/api/billing/portal?${params.toString()}`;
}

export const BILLING_PORTAL_ERROR_PARAM = "billingPortalError";
export const BILLING_PORTAL_ERROR_GENERAL = "1";
export const BILLING_PORTAL_ERROR_UNAUTHORIZED = "unauthorized";

export function isAllowedBillingPortalNavigation(
  secFetchSite: string | null,
): boolean {
  if (!secFetchSite) {
    return true;
  }

  return secFetchSite !== "cross-site";
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

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

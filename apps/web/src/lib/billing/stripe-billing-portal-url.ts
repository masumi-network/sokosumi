const ALLOWED_STRIPE_BILLING_HOSTS = new Set(["billing.stripe.com"]);

export function isAllowedStripeBillingPortalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      ALLOWED_STRIPE_BILLING_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

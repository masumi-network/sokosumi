import { coreClient } from "@/lib/clients/core.client";

/**
 * True when `plan` is a non-free billing plan name (self-serve paid or
 * enterprise). Null/undefined/free are not paid.
 */
export function isPaidBillingPlan(plan: string | null | undefined): boolean {
  return plan != null && plan !== "free";
}

/**
 * UX/action-level paid coverage check. Mirrors Core's
 * `userHasPaidPlanCoverage`: personal Stripe plan first, then any member
 * org's resolved billing plan (enterprise contract or paid self-serve).
 * Fail closed when lookups error.
 */
export async function hasPaidPlanCoverage(options?: {
  organizationIds?: string[];
}): Promise<boolean> {
  const creditsResult = await coreClient.getMyCredits().catch(() => null);
  if (isPaidBillingPlan(creditsResult?.data.subscription?.plan)) return true;

  let organizationIds = options?.organizationIds;
  if (!organizationIds) {
    const orgs = await coreClient.getMyOrganizations().catch(() => null);
    organizationIds = orgs?.data.map((organization) => organization.id) ?? [];
  }

  if (organizationIds.length === 0) return false;

  const results = await Promise.all(
    organizationIds.map((organizationId) =>
      coreClient.getOrganizationBillingPlan(organizationId).catch(() => null),
    ),
  );

  return results.some((result) => isPaidBillingPlan(result?.data.plan));
}

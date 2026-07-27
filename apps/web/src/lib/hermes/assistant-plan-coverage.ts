import { planUnlocksPersonalAssistant } from "@sokosumi/utils";
import { coreClient } from "@/lib/clients/core.client";

/**
 * UX/action-level coverage check for the personal assistant. Mirrors Core's
 * `userHasAssistantPlanCoverage`: personal Stripe plan first, then any member
 * org's resolved billing plan (enterprise contract, or self-serve at Standard
 * or better). Fail closed when lookups error.
 *
 * The personal probe must be `getMyActiveSubscription` (GET
 * /users/me/subscription), which resolves by userId regardless of the
 * session's active workspace — `getMyCredits` is active-organization-scoped
 * and would report a free org's plan over the user's own paid one.
 */
export async function hasAssistantPlanCoverage(options?: {
  organizationIds?: string[];
}): Promise<boolean> {
  const personalResult = await coreClient
    .getMyActiveSubscription()
    .catch(() => null);
  if (planUnlocksPersonalAssistant(personalResult?.data.subscription?.plan))
    return true;

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

  return results.some((result) => {
    const billingPlan = result?.data;
    if (!billingPlan) return false;
    // Same rule as Core: an "active" enterprise contract past its
    // commercial term is not consumable and does not count as coverage.
    if (billingPlan.mode === "enterprise_contract") {
      return billingPlan.isConsumable;
    }
    return planUnlocksPersonalAssistant(billingPlan.plan);
  });
}

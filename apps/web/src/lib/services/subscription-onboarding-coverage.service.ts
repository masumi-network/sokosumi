import "server-only";

import { cache } from "react";
import { parsePlanName } from "@/components/billing/subscription-plan-utils";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { OrganizationBillingPlan } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services/user.service";

/**
 * Shared "is this a paid self-serve plan?" check for personal subscriptions and
 * org billing plans. Unknown plan strings are treated as unpaid so we do not
 * suppress the gate on garbage data; enterprise is handled separately via mode.
 */
function isPaidSelfServePlan(plan: string | null | undefined): boolean {
  const parsed = parsePlanName(plan);
  return parsed !== null && parsed !== "free";
}

function organizationBillingPlanHasCoverage(
  billingPlan: OrganizationBillingPlan,
): boolean {
  if (billingPlan.mode === "enterprise_contract") {
    return true;
  }

  return isPaidSelfServePlan(billingPlan.plan);
}

async function getOrganizationBillingPlanOrNull(
  organizationId: string,
): Promise<OrganizationBillingPlan | null> {
  try {
    const response =
      await coreClient.getOrganizationBillingPlan(organizationId);
    return response.data;
  } catch (error) {
    if (
      error instanceof CoreApiRequestError &&
      (error.status === 403 || error.status === 404)
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * True when the signed-in user already has paid coverage that should suppress
 * the subscription-only onboarding gate: a personal paid subscription, or any
 * organization membership with a paid self-serve plan or enterprise contract.
 *
 * Deduplicated per request via React cache() — layout and the onboarding
 * loader may both call this on the same render.
 *
 * On unexpected Core failures, returns false (safe default: keep prior
 * show-the-hint behavior) so the app shell does not error.
 */
export const userHasPaidOrEnterpriseCoverage = cache(
  async (): Promise<boolean> => {
    try {
      const [personalSubscriptionResult, members] = await Promise.all([
        coreClient.getMyActiveSubscription().catch((error: unknown) => {
          console.error(
            "Failed to load personal subscription for onboarding coverage",
            error,
          );
          return null;
        }),
        userService.getMyMembersWithOrganizations(),
      ]);

      const personalPlan = personalSubscriptionResult?.data.subscription?.plan;
      if (isPaidSelfServePlan(personalPlan)) {
        return true;
      }

      if (members.length === 0) {
        return false;
      }

      const organizationBillingPlans = await Promise.all(
        members.map((member) =>
          getOrganizationBillingPlanOrNull(member.organizationId),
        ),
      );

      return organizationBillingPlans.some(
        (billingPlan) =>
          billingPlan !== null &&
          organizationBillingPlanHasCoverage(billingPlan),
      );
    } catch (error) {
      console.error(
        "Failed to resolve subscription onboarding coverage",
        error,
      );
      return false;
    }
  },
);

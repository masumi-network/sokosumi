import "server-only";

import type { SelfServeSubscriptionPlanName } from "@sokosumi/utils";
import { cache } from "react";
import { parsePlanName } from "@/components/billing/subscription-plan-utils";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { OrganizationBillingPlan } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services/user.service";

export type OnboardingPersonalPlanResult =
  | { plan: SelfServeSubscriptionPlanName; status: "ok" }
  | { status: "unavailable" };

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

/**
 * Cached per-request org billing read shared by coverage checks and the
 * onboarding loader so the active org is not fetched twice on one navigation.
 */
export const getOrganizationBillingPlanForOnboarding = cache(
  async (organizationId: string): Promise<OrganizationBillingPlan | null> => {
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

      console.error(
        `Failed to load organization billing plan for onboarding (${organizationId})`,
        error,
      );
      return null;
    }
  },
);

/**
 * Cached per-request personal subscription read shared by coverage checks and
 * the onboarding loader.
 */
export const resolvePersonalActiveSubscriptionPlanForOnboarding = cache(
  async (): Promise<OnboardingPersonalPlanResult> => {
    try {
      const response = await coreClient.getMyActiveSubscription();
      const plan =
        parsePlanName(response.data.subscription?.plan) ?? ("free" as const);
      return { plan, status: "ok" };
    } catch (error) {
      console.error(
        "Failed to load personal subscription for onboarding",
        error,
      );
      return { status: "unavailable" };
    }
  },
);

/**
 * True when the signed-in user already has paid coverage that should suppress
 * the subscription-only onboarding gate: a personal paid subscription, or any
 * organization membership with a paid self-serve plan or enterprise contract.
 *
 * Deduplicated per request via React cache() — layout and the onboarding
 * loader may both call this on the same render.
 *
 * On unexpected membership failures, returns false (safe default: keep prior
 * show-the-hint behavior) so the app shell does not error. Per-org billing
 * failures are isolated so one flaky org cannot mask coverage on another.
 */
export const userHasPaidOrEnterpriseCoverage = cache(
  async (): Promise<boolean> => {
    try {
      const [personalPlanResult, members] = await Promise.all([
        resolvePersonalActiveSubscriptionPlanForOnboarding(),
        userService.getMyMembersWithOrganizations(),
      ]);

      if (
        personalPlanResult.status === "ok" &&
        isPaidSelfServePlan(personalPlanResult.plan)
      ) {
        return true;
      }

      if (members.length === 0) {
        return false;
      }

      const organizationBillingPlans = await Promise.all(
        members.map((member) =>
          getOrganizationBillingPlanForOnboarding(member.organizationId),
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

import type { SubscriptionPlanName } from "@sokosumi/utils";
import { MemberRole } from "@sokosumi/utils";
import { Suspense } from "react";
import {
  type PaidSubscriptionPlanView,
  resolveCurrentPlanName,
} from "@/components/billing/subscription-plan-utils";
import { listActiveSubscriptions } from "@/lib/auth/auth.server";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { Organization } from "@/lib/clients/generated/core";
import {
  organizationSeatService,
  userHasPaidOrEnterpriseCoverage,
  userService,
} from "@/lib/services";

import { MarkSubscriptionOnboardingGateSeen } from "./mark-subscription-onboarding-gate-seen";
import {
  OnboardingDialog,
  type OnboardingSubscriptionCheckoutMode,
} from "./onboarding-dialog";
import { OnboardingSubscriptionReturnHandler } from "./onboarding-subscription-return-handler";

const PLAN_ORDER = [
  "free",
  "starter",
  "standard",
  "pro",
] as const satisfies SubscriptionPlanName[];

interface OnboardingDialogLoaderProps {
  activeOrganization: Organization | null;
  loginId?: null | string;
  subscriptionOnly?: boolean;
}

function SubscriptionOnboardingReturnOnly() {
  return (
    <Suspense fallback={null}>
      <OnboardingSubscriptionReturnHandler />
    </Suspense>
  );
}

function SuppressedSubscriptionOnboardingGate({
  loginId,
}: {
  loginId?: null | string;
}) {
  return (
    <>
      {loginId ? (
        <MarkSubscriptionOnboardingGateSeen loginId={loginId} />
      ) : null}
      <SubscriptionOnboardingReturnOnly />
    </>
  );
}

export async function OnboardingDialogLoader({
  activeOrganization,
  loginId,
  subscriptionOnly = false,
}: OnboardingDialogLoaderProps) {
  if (subscriptionOnly) {
    // Defense-in-depth: layout already skips mounting this loader when coverage
    // is true (and React cache() dedupes). Keep the check so direct callers and
    // tests still suppress the hint without relying on layout wiring.
    const hasPaidOrEnterpriseCoverage = await userHasPaidOrEnterpriseCoverage();
    if (hasPaidOrEnterpriseCoverage) {
      return <SuppressedSubscriptionOnboardingGate loginId={loginId} />;
    }
  }

  let prefetchedOrganizationMember:
    | Awaited<ReturnType<typeof userService.getMyMemberInOrganization>>
    | undefined;

  if (subscriptionOnly && activeOrganization) {
    prefetchedOrganizationMember = await userService.getMyMemberInOrganization(
      activeOrganization.id,
    );
    const canManageOrganizationSubscription =
      prefetchedOrganizationMember?.role === MemberRole.OWNER ||
      prefetchedOrganizationMember?.role === MemberRole.ADMIN;
    if (!canManageOrganizationSubscription) {
      // Subscription-only gate is intentionally hidden for non-admin members.
      // Do not touch Stripe, org billing, or personal subscription APIs here —
      // the client dialog would render null anyway, and the session cookie is
      // intentionally not set so switching to a personal workspace can still
      // show the gate.
      return <SubscriptionOnboardingReturnOnly />;
    }
  }

  let subscriptionCatalog:
    | Awaited<ReturnType<typeof coreClient.getSubscriptionCatalog>>["data"]
    | null = null;
  try {
    const response = await coreClient.getSubscriptionCatalog();
    subscriptionCatalog = response.data;
  } catch (error) {
    console.error("Failed to load subscription catalog for onboarding", error);
  }

  if (!subscriptionCatalog) {
    return <SubscriptionOnboardingReturnOnly />;
  }

  const organizationMemberPromise =
    prefetchedOrganizationMember !== undefined
      ? Promise.resolve(prefetchedOrganizationMember)
      : activeOrganization
        ? userService.getMyMemberInOrganization(activeOrganization.id)
        : Promise.resolve(null);
  const organizationBillingPlanPromise = activeOrganization
    ? coreClient
        .getOrganizationBillingPlan(activeOrganization.id)
        .then((response) => response.data)
        .catch((error: unknown) => {
          // A stale active organization (e.g. revoked membership) must not
          // break onboarding — fall back to no organization plan.
          if (
            error instanceof CoreApiRequestError &&
            (error.status === 403 || error.status === 404)
          ) {
            return null;
          }
          throw error;
        })
    : Promise.resolve(null);
  const organizationSeatSummaryPromise = activeOrganization
    ? organizationSeatService.getSeatSummary(activeOrganization.id)
    : Promise.resolve(null);

  const [organizationMember, organizationBillingPlan, organizationSeatSummary] =
    await Promise.all([
      organizationMemberPromise,
      organizationBillingPlanPromise,
      organizationSeatSummaryPromise,
    ]);

  const canManageOrganizationSubscription =
    organizationMember?.role === MemberRole.OWNER ||
    organizationMember?.role === MemberRole.ADMIN;
  // 0 when the seat summary is unavailable: the core Organization type has no
  // member count, so there is no local fallback anymore (was _count.members).
  const organizationMemberCount = organizationSeatSummary?.memberCount ?? 0;
  const organizationCurrentPlan = organizationBillingPlan?.plan ?? null;
  const hasActiveOrganization = activeOrganization !== null;
  const subscriptionCheckoutMode: OnboardingSubscriptionCheckoutMode =
    hasActiveOrganization
      ? canManageOrganizationSubscription
        ? "organization"
        : "restricted"
      : "personal";

  let personalCurrentPlan: ReturnType<typeof resolveCurrentPlanName> | null =
    null;
  if (subscriptionCheckoutMode !== "organization") {
    const personalActiveSubscriptionsResult = await listActiveSubscriptions({
      customerType: "user",
    });

    if (personalActiveSubscriptionsResult.isErr()) {
      return <SubscriptionOnboardingReturnOnly />;
    }

    personalCurrentPlan =
      resolveCurrentPlanName(personalActiveSubscriptionsResult.value) ?? "free";
  }

  const currentPlan =
    subscriptionCheckoutMode === "organization"
      ? (organizationCurrentPlan ?? "free")
      : (personalCurrentPlan ?? "free");

  // Active-org billing can still be paid/enterprise after the early coverage
  // check (e.g. personal subscription read failed). Never show the paid-plan
  // hint when the checkout context is already covered.
  if (
    subscriptionOnly &&
    (organizationBillingPlan?.mode === "enterprise_contract" ||
      currentPlan !== "free")
  ) {
    return <SuppressedSubscriptionOnboardingGate loginId={loginId} />;
  }

  const onboardingPlans: PaidSubscriptionPlanView[] = PLAN_ORDER.flatMap(
    (planName) => {
      if (planName === "free") {
        return [];
      }

      const plan = subscriptionCatalog[planName];
      return [
        {
          credits: plan.credits,
          currency: plan.currency,
          isCurrent: currentPlan === planName,
          monthlyAmount: plan.monthlyAmount,
          name: planName,
        },
      ];
    },
  );

  const organizationSubscription =
    activeOrganization && subscriptionCheckoutMode === "organization"
      ? {
          assignedSeatCount: organizationSeatSummary?.assignedCount ?? 0,
          currentSeats: organizationSeatSummary?.purchasedSeats ?? 1,
          memberCount: organizationMemberCount,
          organizationId: activeOrganization.id,
        }
      : undefined;

  return (
    <>
      <SubscriptionOnboardingReturnOnly />
      <OnboardingDialog
        loginId={loginId}
        organizationSubscription={organizationSubscription}
        paidPlans={onboardingPlans}
        subscriptionCheckoutMode={subscriptionCheckoutMode}
        subscriptionOnly={subscriptionOnly}
      />
    </>
  );
}

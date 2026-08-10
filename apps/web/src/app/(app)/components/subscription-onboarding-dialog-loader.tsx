import type { SelfServeSubscriptionPlanName } from "@sokosumi/utils";
import { Suspense } from "react";
import { toPaidSubscriptionPlanViews } from "@/components/billing/subscription-catalog-plans";
import { coreClient } from "@/lib/clients/core.client";
import type { Organization } from "@/lib/clients/generated/core";
import { MemberRole } from "@/lib/clients/generated/core";
import {
  getOrganizationBillingPlanForOnboarding,
  organizationSeatService,
  resolvePersonalActiveSubscriptionPlanForOnboarding,
  userHasPaidOrEnterpriseCoverage,
  userService,
} from "@/lib/services";

import { MarkSubscriptionOnboardingGateSeen } from "./mark-subscription-onboarding-gate-seen";
import { OnboardingSubscriptionReturnHandler } from "./onboarding-subscription-return-handler";
import {
  type OnboardingSubscriptionCheckoutMode,
  SubscriptionOnboardingDialog,
} from "./subscription-onboarding-dialog";

interface SubscriptionOnboardingDialogLoaderProps {
  activeOrganization: Organization | null;
  loginId?: null | string;
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

export async function SubscriptionOnboardingDialogLoader({
  activeOrganization,
  loginId,
}: SubscriptionOnboardingDialogLoaderProps) {
  // Defense-in-depth: layout mounts this loader for free-plan users and lets
  // us suppress the gate when coverage exists (React cache() dedupes). Keep
  // the check so direct callers and tests still suppress the hint without
  // relying on layout wiring.
  const hasPaidOrEnterpriseCoverage = await userHasPaidOrEnterpriseCoverage();
  if (hasPaidOrEnterpriseCoverage) {
    return <SuppressedSubscriptionOnboardingGate loginId={loginId} />;
  }

  let prefetchedOrganizationMember:
    | Awaited<ReturnType<typeof userService.getMyMemberInOrganization>>
    | undefined;

  if (activeOrganization) {
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
    ? getOrganizationBillingPlanForOnboarding(activeOrganization.id)
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

  let personalCurrentPlan: SelfServeSubscriptionPlanName | null = null;
  if (subscriptionCheckoutMode !== "organization") {
    const personalPlanResult =
      await resolvePersonalActiveSubscriptionPlanForOnboarding();

    if (personalPlanResult.status === "unavailable") {
      return <SubscriptionOnboardingReturnOnly />;
    }

    personalCurrentPlan = personalPlanResult.plan;
  }

  const currentPlan =
    subscriptionCheckoutMode === "organization"
      ? (organizationCurrentPlan ?? "free")
      : (personalCurrentPlan ?? "free");

  // Active-org billing can still be paid/enterprise after the early coverage
  // check (e.g. personal subscription read failed). Never show the paid-plan
  // hint when the checkout context is already covered.
  if (
    organizationBillingPlan?.mode === "enterprise_contract" ||
    currentPlan !== "free"
  ) {
    return <SuppressedSubscriptionOnboardingGate loginId={loginId} />;
  }

  const onboardingPlans = toPaidSubscriptionPlanViews(
    subscriptionCatalog,
    currentPlan,
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
      <SubscriptionOnboardingDialog
        loginId={loginId}
        organizationSubscription={organizationSubscription}
        paidPlans={onboardingPlans}
        subscriptionCheckoutMode={subscriptionCheckoutMode}
      />
    </>
  );
}

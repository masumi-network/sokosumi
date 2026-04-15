import { MemberRole, type OrganizationWithRelations } from "@sokosumi/database";
import { subscriptionRepository } from "@sokosumi/database/repositories";
import { headers } from "next/headers";
import { Suspense } from "react";
import Stripe from "stripe";

import {
  type ActiveSubscription,
  type PaidSubscriptionPlanView,
  parsePlanName,
  resolveCurrentPlanName,
} from "@/components/billing/subscription-plan-utils";
import { getEnvSecrets } from "@/config/env.secrets";
import { auth } from "@/lib/auth/auth";
import prisma from "@/lib/db/prisma";
import { userService } from "@/lib/services";
import {
  getSubscriptionCatalog,
  type SubscriptionPlanName,
} from "@/lib/stripe/subscription-catalog";

import {
  OnboardingDialog,
  type OnboardingSubscriptionCheckoutMode,
} from "./onboarding-dialog";
import { OnboardingSubscriptionReturnHandler } from "./onboarding-subscription-return-handler";

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);
const PLAN_ORDER: SubscriptionPlanName[] = [
  "free",
  "starter",
  "standard",
  "pro",
];

interface OnboardingDialogLoaderProps {
  activeOrganization: OrganizationWithRelations | null;
  loginId?: null | string;
  subscriptionOnly?: boolean;
}

export async function OnboardingDialogLoader({
  activeOrganization,
  loginId,
  subscriptionOnly = false,
}: OnboardingDialogLoaderProps) {
  let subscriptionCatalog: Awaited<
    ReturnType<typeof getSubscriptionCatalog>
  > | null = null;
  try {
    subscriptionCatalog = await getSubscriptionCatalog(stripeInstance);
  } catch (error) {
    console.error("Failed to load subscription catalog for onboarding", error);
  }

  if (!subscriptionCatalog) {
    return (
      <Suspense fallback={null}>
        <OnboardingSubscriptionReturnHandler />
      </Suspense>
    );
  }

  const organizationMemberPromise = activeOrganization
    ? userService.getMyMemberInOrganization(activeOrganization.id)
    : Promise.resolve(null);
  const latestOrganizationSubscriptionPromise = activeOrganization
    ? subscriptionRepository.getLatestActiveSubscriptionByReferenceId(
        activeOrganization.id,
        prisma,
      )
    : Promise.resolve(null);

  const [organizationMember, latestOrganizationSubscription] =
    await Promise.all([
      organizationMemberPromise,
      latestOrganizationSubscriptionPromise,
    ]);

  const canManageOrganizationSubscription =
    organizationMember?.role === MemberRole.OWNER ||
    organizationMember?.role === MemberRole.ADMIN;
  const organizationMemberCount = activeOrganization?._count.members ?? 0;
  const organizationCurrentPlan = parsePlanName(
    latestOrganizationSubscription?.plan,
  );
  const hasActiveOrganization = activeOrganization !== null;
  const personalCurrentPlan = hasActiveOrganization
    ? null
    : (resolveCurrentPlanName(
        (await auth.api.listActiveSubscriptions({
          headers: await headers(),
          query: {
            customerType: "user",
          },
        })) as ActiveSubscription[],
      ) ?? "free");
  const subscriptionCheckoutMode: OnboardingSubscriptionCheckoutMode =
    hasActiveOrganization
      ? canManageOrganizationSubscription
        ? "organization"
        : "restricted"
      : "personal";
  const currentPlan = hasActiveOrganization
    ? (organizationCurrentPlan ?? "free")
    : (personalCurrentPlan ?? "free");

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
          currentSeats: Math.max(
            latestOrganizationSubscription?.seats ?? 1,
            organizationMemberCount,
          ),
          memberCount: organizationMemberCount,
          organizationId: activeOrganization.id,
        }
      : undefined;

  return (
    <>
      <Suspense fallback={null}>
        <OnboardingSubscriptionReturnHandler />
      </Suspense>
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

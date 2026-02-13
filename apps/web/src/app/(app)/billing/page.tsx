import { MemberRole } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import Stripe from "stripe";

import { BalanceSection } from "@/components/billing/balance-section";
import { BillingPortalCard } from "@/components/billing/billing-portal-card";
import { BillingTabs } from "@/components/billing/billing-tabs";
import CouponSection from "@/components/billing/coupon-section";
import CreditsSection from "@/components/billing/credits-section";
import { OrganizationSubscriptionSection } from "@/components/billing/organization-subscription-section";
import { PersonalSubscriptionSection } from "@/components/billing/personal-subscription-section";
import {
  type ActiveSubscription,
  parsePlanName,
  resolveLatestSubscription,
  type SubscriptionPlanView,
} from "@/components/billing/subscription-plan-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEnvSecrets } from "@/config/env.secrets";
import { auth } from "@/lib/auth/auth";
import { getAuthContext } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { userService } from "@/lib/services";
import {
  getSubscriptionCatalog,
  type SubscriptionPlanName,
} from "@/lib/stripe/subscription-catalog";

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);
const PLAN_ORDER: SubscriptionPlanName[] = [
  "free",
  "starter",
  "standard",
  "pro",
];

interface BillingPageProps {
  searchParams: Promise<{
    cancel?: string;
    session_id?: string;
    status?: string;
  }>;
}

function parseStatus(status: string | undefined): "cancel" | "success" | null {
  if (status === "success" || status === "cancel") {
    return status;
  }
  return null;
}

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const t = await getTranslations("App.Billing");
  const query = await searchParams;
  const authContext = await getAuthContext();
  const activeOrganizationId = authContext?.organizationId ?? null;
  const activeOrganization = await userService.getActiveOrganization();

  if (!authContext) {
    return null;
  }

  if (activeOrganization) {
    const [member, requestHeaders, subscriptionCatalog] = await Promise.all([
      userService.getMyMemberInOrganization(activeOrganization.id),
      headers(),
      getSubscriptionCatalog(stripeInstance),
    ]);
    const isOwnerOrAdmin =
      member?.role === MemberRole.OWNER || member?.role === MemberRole.ADMIN;

    const activeSubscriptions = await auth.api.listActiveSubscriptions({
      headers: requestHeaders,
      query: {
        customerType: "organization",
        referenceId: activeOrganization.id,
      },
    });

    const latestSubscription = resolveLatestSubscription(
      activeSubscriptions as ActiveSubscription[],
    );
    const currentPlan = parsePlanName(latestSubscription?.plan) ?? "free";
    const canPurchaseCredits = isOwnerOrAdmin && currentPlan !== "free";

    if (!isOwnerOrAdmin) {
      return (
        <div className="min-h-full w-full">
          <div className="mx-auto max-w-4xl px-4 py-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("orgAccessRestrictedTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground">
                  {t("orgAccessRestrictedDescription")}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t("orgAccessRestrictedHint")}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    const balanceInCents = await creditBucketRepository.getBalance(
      authContext.userId,
      activeOrganization.id,
      prisma,
    );
    const currentSeats = Math.max(
      latestSubscription?.seats ?? 1,
      activeOrganization._count.members,
    );
    const credits = convertCentsToCredits(balanceInCents);

    const orgPlans: SubscriptionPlanView[] = PLAN_ORDER.map((planName) => {
      const plan = subscriptionCatalog[planName];
      return {
        credits: plan.credits,
        currency: plan.currency,
        isCurrent: currentPlan === planName,
        monthlyAmount: plan.monthlyAmount,
        name: planName,
      };
    });

    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-4xl space-y-8 px-4 py-6">
          <BalanceSection
            title={t("balanceTitle")}
            description={t("balanceDescriptionOrganization", {
              members: activeOrganization._count.members,
              organization: activeOrganization.name,
              seats: currentSeats,
            })}
            creditsLabel={t("balanceCreditsLabel", { credits })}
          />

          <BillingTabs
            tabLabels={{
              coupon: t("tabs.coupon"),
              credits: t("tabs.credits"),
              subscription: t("tabs.subscription"),
            }}
            showCreditsTab={canPurchaseCredits}
            subscriptionContent={
              <OrganizationSubscriptionSection
                currentPlan={currentPlan}
                currentSeats={currentSeats}
                memberCount={activeOrganization._count.members}
                organizationId={activeOrganization.id}
                plans={orgPlans}
                returnPath="/billing?tab=subscription"
                showBillingPortalButton={false}
              />
            }
            creditsContent={
              <CreditsSection
                isPurchaseEnabled={canPurchaseCredits}
                organization={activeOrganization}
                returnPath="/billing?tab=credits"
                searchParams={query}
              />
            }
            couponContent={
              <CouponSection
                organization={activeOrganization}
                returnPath="/billing?tab=coupon"
                searchParams={query}
              />
            }
          />

          <BillingPortalCard
            baseReturnPath="/billing"
            ctaLabel={t("billingPortalCta")}
            description={t("billingPortalDescription")}
            generalErrorMessage={t("Errors.general")}
            openingLabel={t("openingBillingPortal")}
            organizationId={activeOrganization.id}
            returnPath="/billing"
            title={t("billingPortalTitle")}
            unauthenticatedActionLabel={t("Errors.unauthenticatedAction")}
            unauthenticatedErrorMessage={t("Errors.unauthenticated")}
            unauthorizedErrorMessage={t("Errors.unauthorized")}
          />
        </div>
      </div>
    );
  }

  const [balanceInCents, requestHeaders, subscriptionCatalog] =
    await Promise.all([
      creditBucketRepository.getBalance(authContext.userId, null, prisma),
      headers(),
      getSubscriptionCatalog(stripeInstance),
    ]);

  const [personalActiveSubscriptions, organizationActiveSubscriptions] =
    await Promise.all([
      auth.api.listActiveSubscriptions({
        headers: requestHeaders,
        query: {
          customerType: "user",
        },
      }),
      activeOrganizationId
        ? auth.api.listActiveSubscriptions({
            headers: requestHeaders,
            query: {
              customerType: "organization",
              referenceId: activeOrganizationId,
            },
          })
        : Promise.resolve([]),
    ]);

  const latestPersonalSubscription = resolveLatestSubscription(
    personalActiveSubscriptions as ActiveSubscription[],
  );
  const latestOrganizationSubscription = resolveLatestSubscription(
    organizationActiveSubscriptions as ActiveSubscription[],
  );
  const latestSubscription =
    latestOrganizationSubscription ?? latestPersonalSubscription;
  const currentPlan = parsePlanName(latestSubscription?.plan) ?? "free";
  const credits = convertCentsToCredits(balanceInCents);
  const personalPlans: SubscriptionPlanView[] = PLAN_ORDER.map((planName) => {
    const plan = subscriptionCatalog[planName];
    return {
      credits: plan.credits,
      currency: plan.currency,
      isCurrent: currentPlan === planName,
      monthlyAmount: plan.monthlyAmount,
      name: planName,
    };
  });

  const canPurchaseCredits = currentPlan !== "free";

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-6">
        <BalanceSection
          title={t("balanceTitle")}
          description={t("balanceDescriptionPersonal")}
          creditsLabel={t("balanceCreditsLabel", { credits })}
        />

        <BillingTabs
          tabLabels={{
            coupon: t("tabs.coupon"),
            credits: t("tabs.credits"),
            subscription: t("tabs.subscription"),
          }}
          showCreditsTab={canPurchaseCredits}
          subscriptionContent={
            <PersonalSubscriptionSection
              plans={personalPlans}
              returnPath="/billing?tab=subscription"
              status={parseStatus(query.status)}
            />
          }
          creditsContent={
            <CreditsSection
              isPurchaseEnabled={canPurchaseCredits}
              organization={null}
              returnPath="/billing?tab=credits"
              searchParams={query}
            />
          }
          couponContent={
            <CouponSection
              organization={null}
              returnPath="/billing?tab=coupon"
              searchParams={query}
            />
          }
        />

        <BillingPortalCard
          baseReturnPath="/billing"
          ctaLabel={t("billingPortalCta")}
          description={t("billingPortalDescription")}
          generalErrorMessage={t("Errors.general")}
          openingLabel={t("openingBillingPortal")}
          returnPath="/billing"
          title={t("billingPortalTitle")}
          unauthenticatedActionLabel={t("Errors.unauthenticatedAction")}
          unauthenticatedErrorMessage={t("Errors.unauthenticated")}
        />
      </div>
    </div>
  );
}

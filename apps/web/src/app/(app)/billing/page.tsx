import { MemberRole } from "@sokosumi/database";
import {
  creditBucketRepository,
  subscriptionRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { convertCentsToCredits } from "@sokosumi/utils";
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
  parsePlanName,
  type SubscriptionPlanView,
} from "@/components/billing/subscription-plan-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEnvSecrets } from "@/config/env.secrets";
import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { zeroMarginTopUpEnabled } from "@/lib/flags/zero-margin-top-up";
import { userService } from "@/lib/services";
import { ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY } from "@/lib/stripe/credit-topup-pricing";
import {
  getSubscriptionCatalog,
  type SubscriptionPlanName,
} from "@/lib/stripe/subscription-catalog";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

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
    tab?: string;
  }>;
}

function parseStatus(status: string | undefined): "cancel" | "success" | null {
  if (status === "success" || status === "cancel") {
    return status;
  }
  return null;
}

type BillingTab = "subscription" | "credits" | "coupon";

function parseBillingTab(tab: string | undefined): BillingTab {
  if (tab === "credits" || tab === "coupon" || tab === "subscription") {
    return tab;
  }

  return "subscription";
}

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const t = await getTranslations("App.Billing");
  const [query, session, activeOrganization, isZeroMarginTopUpEnabled] =
    await Promise.all([
      searchParams,
      getSession(),
      userService.getActiveOrganization(),
      zeroMarginTopUpEnabled(),
    ]);
  const activeTab = parseBillingTab(query.tab);

  if (!session) {
    return null;
  }
  const userId = session.user.id;
  const creditsPriceLookupKeyOverride = isZeroMarginTopUpEnabled
    ? ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY
    : undefined;

  if (activeOrganization) {
    const [member, subscriptionCatalog] = await Promise.all([
      userService.getMyMemberInOrganization(activeOrganization.id),
      getSubscriptionCatalog(stripeInstance),
    ]);
    const isOwnerOrAdmin =
      member?.role === MemberRole.OWNER || member?.role === MemberRole.ADMIN;

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

    const latestSubscription =
      await subscriptionRepository.getLatestActiveSubscriptionByReferenceId(
        activeOrganization.id,
        prisma,
      );
    const currentPlan = parsePlanName(latestSubscription?.plan) ?? "free";
    const canPurchaseCredits =
      isOwnerOrAdmin && (currentPlan !== "free" || isZeroMarginTopUpEnabled);
    const creditsCheckoutParams =
      canPurchaseCredits && activeTab === "credits"
        ? { cancel: query.cancel, session_id: query.session_id }
        : undefined;
    const couponCheckoutParams =
      activeTab === "coupon"
        ? { cancel: query.cancel, session_id: query.session_id }
        : undefined;

    const balanceInCents = await creditBucketRepository.getBalance(
      userId,
      activeOrganization.id,
      prisma,
    );
    const currentSeats = Math.max(
      latestSubscription?.seats ?? 1,
      activeOrganization._count.members,
    );
    const credits = convertCentsToCredits(balanceInCents);
    const displayCredits = formatCreditsForDisplay(credits);

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
            creditsLabel={t("balanceCreditsLabel", {
              credits: displayCredits,
            })}
          />

          <BillingTabs
            tabLabels={{
              coupon: t("tabs.coupon"),
              credits: t("tabs.credits"),
              subscription: t("tabs.subscription"),
            }}
            showCreditsTab
            subscriptionContent={
              <OrganizationSubscriptionSection
                cancelAtPeriodEnd={
                  latestSubscription?.cancelAtPeriodEnd ?? false
                }
                currentPlan={currentPlan}
                currentPeriodEnd={latestSubscription?.periodEnd ?? null}
                currentSeats={currentSeats}
                memberCount={activeOrganization._count.members}
                organizationId={activeOrganization.id}
                plans={orgPlans}
                returnPath="/billing?tab=subscription"
              />
            }
            creditsContent={
              <CreditsSection
                isPurchaseEnabled={canPurchaseCredits}
                organization={activeOrganization}
                priceLookupKeyOverride={creditsPriceLookupKeyOverride}
                returnPath="/billing?tab=credits"
                searchParams={creditsCheckoutParams}
              />
            }
            couponContent={
              <CouponSection
                organization={activeOrganization}
                returnPath="/billing?tab=coupon"
                searchParams={couponCheckoutParams}
              />
            }
          />

          {activeOrganization.stripeCustomerId ? (
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
          ) : null}
        </div>
      </div>
    );
  }

  const [
    balanceInCents,
    latestPersonalSubscription,
    subscriptionCatalog,
    user,
  ] = await Promise.all([
    creditBucketRepository.getBalance(userId, null, prisma),
    subscriptionRepository.getLatestActiveSubscriptionByReferenceId(
      userId,
      prisma,
    ),
    getSubscriptionCatalog(stripeInstance),
    userRepository.getUserById(userId, prisma),
  ]);
  const currentPlan = parsePlanName(latestPersonalSubscription?.plan) ?? "free";
  const credits = convertCentsToCredits(balanceInCents);
  const displayCredits = formatCreditsForDisplay(credits);
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

  const canPurchaseCredits = currentPlan !== "free" || isZeroMarginTopUpEnabled;
  const creditsCheckoutParams =
    canPurchaseCredits && activeTab === "credits"
      ? { cancel: query.cancel, session_id: query.session_id }
      : undefined;
  const couponCheckoutParams =
    activeTab === "coupon"
      ? { cancel: query.cancel, session_id: query.session_id }
      : undefined;

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-6">
        <BalanceSection
          title={t("balanceTitle")}
          description={t("balanceDescriptionPersonal")}
          creditsLabel={t("balanceCreditsLabel", {
            credits: displayCredits,
          })}
        />

        <BillingTabs
          tabLabels={{
            coupon: t("tabs.coupon"),
            credits: t("tabs.credits"),
            subscription: t("tabs.subscription"),
          }}
          showCreditsTab
          subscriptionContent={
            <PersonalSubscriptionSection
              cancelAtPeriodEnd={
                latestPersonalSubscription?.cancelAtPeriodEnd ?? false
              }
              currentPeriodEnd={latestPersonalSubscription?.periodEnd ?? null}
              plans={personalPlans}
              returnPath="/billing?tab=subscription"
              status={parseStatus(query.status)}
            />
          }
          creditsContent={
            <CreditsSection
              isPurchaseEnabled={canPurchaseCredits}
              organization={null}
              priceLookupKeyOverride={creditsPriceLookupKeyOverride}
              returnPath="/billing?tab=credits"
              searchParams={creditsCheckoutParams}
            />
          }
          couponContent={
            <CouponSection
              organization={null}
              returnPath="/billing?tab=coupon"
              searchParams={couponCheckoutParams}
            />
          }
        />

        {user?.stripeCustomerId ? (
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
        ) : null}
      </div>
    </div>
  );
}

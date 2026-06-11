import { MemberRole } from "@sokosumi/database";
import type { SelfServeSubscriptionPlanName } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import Stripe from "stripe";

import { BalanceBillingPortalLink } from "@/components/billing/balance-billing-portal-link";
import { BalanceSection } from "@/components/billing/balance-section";
import { BillingTabs } from "@/components/billing/billing-tabs";
import CouponSection from "@/components/billing/coupon-section";
import CreditsSection from "@/components/billing/credits-section";
import { EnterpriseContractSummary } from "@/components/billing/enterprise-contract-summary";
import { OrganizationSubscriptionSection } from "@/components/billing/organization-subscription-section";
import { PersonalSubscriptionSection } from "@/components/billing/personal-subscription-section";
import {
  parsePlanName,
  type SubscriptionPlanView,
} from "@/components/billing/subscription-plan-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEnvSecrets } from "@/config/env.secrets";
import { getSession } from "@/lib/auth/utils";
import { coreClient } from "@/lib/clients/core.client";
import { zeroMarginTopUpEnabled } from "@/lib/flags/zero-margin-top-up";
import { organizationSeatService, userService } from "@/lib/services";
import { getEnterpriseContractBillingSummary } from "@/lib/services/enterprise-contract-summary.service";
import { ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY } from "@/lib/stripe/credit-topup-pricing";
import { getSubscriptionCatalog } from "@/lib/stripe/subscription-catalog";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);
const PLAN_ORDER = [
  "free",
  "starter",
  "standard",
  "pro",
] as const satisfies SelfServeSubscriptionPlanName[];

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

    const { data: billingPlan } = await coreClient.getOrganizationBillingPlan(
      activeOrganization.id,
    );
    const currentPlan = billingPlan.plan;
    const isEnterpriseContract = billingPlan.mode === "enterprise_contract";
    const isEnterpriseConsumable =
      isEnterpriseContract && billingPlan.isConsumable;
    const showOrganizationBillingPortal = !isEnterpriseConsumable;
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

    const [
      enterpriseContractSummary,
      seatSummary,
      organizationCredits,
      organizationStripeCustomer,
    ] = await Promise.all([
      isEnterpriseContract
        ? getEnterpriseContractBillingSummary(activeOrganization.id)
        : Promise.resolve(null),
      organizationSeatService.getSeatSummary(activeOrganization.id),
      // Always load the org credit balance so the balance section shows the
      // real figure. It is unused when the enterprise summary renders, but is
      // the correct fallback when the enterprise summary is absent (core
      // reports no active contract, 404 -> null) despite the locally resolved
      // plan saying it was an enterprise contract.
      coreClient.getMyOrganizationCredits(activeOrganization.id),
      coreClient.getOrganizationStripeCustomer(activeOrganization.id),
    ]);
    const organizationStripeCustomerId =
      organizationStripeCustomer.data.stripeCustomerId;
    const currentSeats = seatSummary.purchasedSeats;
    const displayCredits = formatCreditsForDisplay(
      organizationCredits.data.credits.total,
    );
    const organizationBillingPortal =
      organizationStripeCustomerId && showOrganizationBillingPortal ? (
        <BalanceBillingPortalLink
          baseReturnPath="/billing"
          description={t("billingPortalDescription")}
          generalErrorMessage={t("Errors.general")}
          label={t("manageYourBilling")}
          openingLabel={t("openingBillingPortal")}
          organizationId={activeOrganization.id}
          returnPath="/billing"
          unauthenticatedActionLabel={t("Errors.unauthenticatedAction")}
          unauthenticatedErrorMessage={t("Errors.unauthenticated")}
          unauthorizedErrorMessage={t("Errors.unauthorized")}
        />
      ) : null;

    const orgPlans: SubscriptionPlanView[] = PLAN_ORDER.map((planName) => {
      const plan = subscriptionCatalog[planName];
      return {
        credits: plan.credits,
        currency: plan.currency,
        isCurrent: !isEnterpriseConsumable && currentPlan === planName,
        monthlyAmount: plan.monthlyAmount,
        name: planName,
      };
    });

    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-4xl space-y-8 px-4 py-6">
          {enterpriseContractSummary ? (
            <EnterpriseContractSummary summary={enterpriseContractSummary} />
          ) : (
            <BalanceSection
              title={t("balanceTitle")}
              description={t("balanceDescriptionOrganization", {
                assigned: seatSummary.assignedCount,
                members: seatSummary.memberCount,
                organization: activeOrganization.name,
                purchased: seatSummary.purchasedSeats,
                unused: seatSummary.unusedSeats,
              })}
              creditsLabel={t("balanceCreditsLabel", {
                credits: displayCredits,
              })}
              stripeCustomerId={organizationStripeCustomerId}
              stripeCustomerLabel={t("stripeCustomerIdLabel")}
              billingPortal={organizationBillingPortal}
            />
          )}

          <BillingTabs
            tabLabels={{
              coupon: t("tabs.coupon"),
              credits: t("tabs.credits"),
              subscription: t("tabs.subscription"),
            }}
            showCreditsTab
            subscriptionContent={
              <OrganizationSubscriptionSection
                assignedSeatCount={seatSummary.assignedCount}
                cancelAtPeriodEnd={billingPlan.cancelAtPeriodEnd}
                currentPlan={currentPlan}
                currentPeriodEnd={billingPlan.periodEnd}
                currentSeats={currentSeats}
                isEnterpriseConsumable={isEnterpriseConsumable}
                isEnterpriseContract={isEnterpriseContract}
                memberCount={seatSummary.memberCount}
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
        </div>
      </div>
    );
  }

  const [
    personalCredits,
    personalSubscription,
    subscriptionCatalog,
    stripeCustomer,
  ] = await Promise.all([
    coreClient.getMyCredits(),
    coreClient.getMyActiveSubscription(),
    getSubscriptionCatalog(stripeInstance),
    coreClient.getMyStripeCustomer(),
  ]);
  const latestPersonalSubscription = personalSubscription.data.subscription;
  const stripeCustomerId = stripeCustomer.data.stripeCustomerId;
  const currentPlan = parsePlanName(latestPersonalSubscription?.plan) ?? "free";
  const displayCredits = formatCreditsForDisplay(
    personalCredits.data.credits.total,
  );
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
          stripeCustomerId={stripeCustomerId}
          stripeCustomerLabel={t("stripeCustomerIdLabel")}
          billingPortal={
            stripeCustomerId ? (
              <BalanceBillingPortalLink
                baseReturnPath="/billing"
                description={t("billingPortalDescription")}
                generalErrorMessage={t("Errors.general")}
                label={t("manageYourBilling")}
                openingLabel={t("openingBillingPortal")}
                returnPath="/billing"
                unauthenticatedActionLabel={t("Errors.unauthenticatedAction")}
                unauthenticatedErrorMessage={t("Errors.unauthenticated")}
              />
            ) : null
          }
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
      </div>
    </div>
  );
}

import type { SelfServeSubscriptionPlanName } from "@sokosumi/utils";
import { MemberRole } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";

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
import { getSession } from "@/lib/auth/auth.server";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import { organizationSeatService, userService } from "@/lib/services";
import { getEnterpriseContractBillingSummary } from "@/lib/services/enterprise-contract-summary.service";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

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
  const [query, session, activeOrganization] = await Promise.all([
    searchParams,
    getSession(),
    userService.getActiveOrganization(),
  ]);
  const activeTab = parseBillingTab(query.tab);

  if (!session) {
    return null;
  }

  const creditPricing = await coreClient
    .getCreditTopUpPriceCatalog()
    .then((response) => response.data);
  const canPurchaseOnFreePlan = creditPricing.canPurchaseOnFreePlan;

  if (activeOrganization) {
    const [member, subscriptionCatalog] = await Promise.all([
      userService.getMyMemberInOrganization(activeOrganization.id),
      coreClient.getSubscriptionCatalog().then((response) => response.data),
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
      isOwnerOrAdmin && (currentPlan !== "free" || canPurchaseOnFreePlan);
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
      organizationStripeCustomerId,
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
      coreClient
        .getOrganizationStripeCustomer(activeOrganization.id)
        .then((response) => response.data.stripeCustomerId)
        .catch((error: unknown) => {
          // The old code read stripeCustomerId off the locally loaded
          // organization and had no failure mode here; don't let a stale
          // membership (403) or missing organization (404) take down the
          // whole billing page — just hide the billing portal.
          if (
            error instanceof CoreApiRequestError &&
            (error.status === 403 || error.status === 404)
          ) {
            return null;
          }
          throw error;
        }),
    ]);
    // `getSeatSummary` resolves null when core reports a stale membership
    // (403/404); fall back to zero counts so the page still renders, matching
    // the onboarding loader's behavior.
    const seatCounts = seatSummary ?? {
      assignedCount: 0,
      memberCount: 0,
      purchasedSeats: 0,
      unusedSeats: 0,
    };
    const currentSeats = seatCounts.purchasedSeats;
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
                assigned: seatCounts.assignedCount,
                members: seatCounts.memberCount,
                organization: activeOrganization.name,
                purchased: seatCounts.purchasedSeats,
                unused: seatCounts.unusedSeats,
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
                assignedSeatCount={seatCounts.assignedCount}
                cancelAtPeriodEnd={billingPlan.cancelAtPeriodEnd}
                currentPlan={currentPlan}
                currentPeriodEnd={billingPlan.periodEnd}
                currentSeats={currentSeats}
                isEnterpriseConsumable={isEnterpriseConsumable}
                isEnterpriseContract={isEnterpriseContract}
                memberCount={seatCounts.memberCount}
                organizationId={activeOrganization.id}
                plans={orgPlans}
                returnPath="/billing?tab=subscription"
              />
            }
            creditsContent={
              <CreditsSection
                isPurchaseEnabled={canPurchaseCredits}
                organization={activeOrganization}
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
    coreClient.getSubscriptionCatalog().then((response) => response.data),
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

  const canPurchaseCredits = currentPlan !== "free" || canPurchaseOnFreePlan;
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

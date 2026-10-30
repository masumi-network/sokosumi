"use client";

import {
  CORE_API_ERROR_KINDS,
  type PaidSubscriptionPlanName,
} from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { OrganizationErrorCode } from "@/lib/actions/errors/error-codes/organization";
import { upgradeOrganizationSubscription } from "@/lib/actions/subscription/action";
import { buildBillingPortalRedirectPath } from "@/lib/billing/billing-portal-redirect";
import { fireGTMEvent } from "@/lib/gtm-events";
import { cn } from "@/lib/utils";
import {
  OrganizationSeatSettingsFields,
  resolveMinimumOrganizationSeats,
  resolveTargetOrganizationSeats,
} from "./organization-seat-settings-fields";
import { OrganizationSeatsCard } from "./organization-seats-card";
import { SubscriptionEnterprisePlanCard } from "./subscription-enterprise-plan-card";
import { SubscriptionFreePlanRow } from "./subscription-free-plan-row";
import { SubscriptionPlanCard } from "./subscription-plan-card";
import {
  type SubscriptionPlanView,
  splitSubscriptionPlans,
} from "./subscription-plan-utils";

interface OrganizationSubscriptionSectionProps {
  assignedCount: number;
  currentSeats: number;
  isEnterpriseConsumable: boolean;
  isEnterpriseContract: boolean;
  memberCount: number;
  organizationId: string;
  plans: SubscriptionPlanView[];
  returnPath: string;
  scheduledCancelDate: Date | null;
  scheduledSeats: number | null;
  scheduledSeatsAt: Date | null;
}

export function OrganizationSubscriptionSection({
  assignedCount,
  currentSeats,
  isEnterpriseConsumable,
  isEnterpriseContract,
  memberCount,
  organizationId,
  plans,
  returnPath,
  scheduledCancelDate,
  scheduledSeats,
  scheduledSeatsAt,
}: OrganizationSubscriptionSectionProps) {
  const t = useTranslations(
    "App.Organizations.OrganizationDetail.Subscription",
  );
  const tSubscriptions = useTranslations("App.Subscriptions");
  const formatter = useFormatter();
  const router = useRouter();
  const { freePlan, paidPlans } = useMemo(
    () => splitSubscriptionPlans(plans),
    [plans],
  );

  const minimumSeats = useMemo(() => resolveMinimumOrganizationSeats(), []);
  const [targetSeats, setTargetSeats] = useState<number | null>(
    resolveTargetOrganizationSeats(currentSeats),
  );
  const [pendingPlan, setPendingPlan] =
    useState<PaidSubscriptionPlanName | null>(null);

  useEffect(() => {
    setTargetSeats(resolveTargetOrganizationSeats(currentSeats));
  }, [currentSeats]);

  const cancellationDate = useMemo(() => {
    if (!scheduledCancelDate) {
      return null;
    }

    return formatter.dateTime(scheduledCancelDate, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }, [scheduledCancelDate, formatter]);

  const cancellationLabel = useMemo(() => {
    if (!cancellationDate) {
      return null;
    }

    return tSubscriptions("cancelsOnDate", {
      date: cancellationDate,
    });
  }, [cancellationDate, tSubscriptions]);

  const showEnterpriseExclusiveUi =
    isEnterpriseContract && isEnterpriseConsumable;
  const showEnterprisePostTermUi =
    isEnterpriseContract && !isEnterpriseConsumable;
  const hasCurrentPaidPlan = paidPlans.some((plan) => plan.isCurrent);
  // A plan switch keeps the purchased seats; the seats card changes them.
  const checkoutSeats = hasCurrentPaidPlan
    ? resolveTargetOrganizationSeats(currentSeats)
    : targetSeats;
  const isCheckoutSeatsValid =
    checkoutSeats !== null && checkoutSeats >= minimumSeats;

  const handleOpenLogin = useCallback(() => {
    router.push("/signin");
  }, [router]);

  const getSubscriptionActionErrorMessage = useCallback(
    (error: { code: string; message?: string | null }): string => {
      if (error.message) {
        return error.message;
      }

      switch (error.code) {
        case OrganizationErrorCode.ORGANIZATION_ENTERPRISE_CONTRACT_EXCLUSIVE:
          return t("Errors.enterpriseContractExclusive");
        case CommonErrorCode.BAD_INPUT:
          return t("Errors.badInput");
        case CommonErrorCode.UNAUTHORIZED:
          return t("Errors.unauthorized");
        default:
          return t("Errors.general");
      }
    },
    [t],
  );

  const handleSubscriptionActionError = useCallback(
    (error: { code: string; kind?: string; message?: string | null }) => {
      if (error.code === CommonErrorCode.UNAUTHENTICATED) {
        toast.error(t("Errors.unauthenticated"), {
          action: {
            label: t("Errors.unauthenticatedAction"),
            onClick: handleOpenLogin,
          },
        });
        return;
      }

      if (error.kind === CORE_API_ERROR_KINDS.SUBSCRIPTION_PAYMENT_FAILED) {
        toast.error(t("Errors.paymentFailed"), {
          action: {
            label: t("Errors.paymentFailedAction"),
            onClick: () => {
              window.location.assign(
                buildBillingPortalRedirectPath({ organizationId, returnPath }),
              );
            },
          },
        });
        return;
      }

      toast.error(getSubscriptionActionErrorMessage(error));
    },
    [
      getSubscriptionActionErrorMessage,
      handleOpenLogin,
      organizationId,
      returnPath,
      t,
    ],
  );

  const handleUpgradePlan = useCallback(
    async (planName: PaidSubscriptionPlanName) => {
      if (checkoutSeats === null || checkoutSeats < minimumSeats) {
        toast.error(t("Errors.badInput"));
        return;
      }

      setPendingPlan(planName);
      try {
        const result = await upgradeOrganizationSubscription({
          organizationId,
          plan: planName,
          returnPath,
          seats: checkoutSeats,
        });
        if (!result.ok) {
          handleSubscriptionActionError(result.error);
          return;
        }

        if (result.value.mode === "redirect") {
          fireGTMEvent.beginCheckout({ plan: planName, seats: checkoutSeats });
          window.location.href = result.value.url;
          return;
        }

        toast.success(tSubscriptions("statusSuccess"));
        router.refresh();
      } finally {
        setPendingPlan(null);
      }
    },
    [
      checkoutSeats,
      handleSubscriptionActionError,
      minimumSeats,
      organizationId,
      returnPath,
      router,
      t,
    ],
  );

  const isCancellationScheduled = scheduledCancelDate !== null;

  function getPlanPresentationProps(plan: SubscriptionPlanView) {
    const isCurrentPlan = plan.isCurrent;

    let actionLabel: null | string = t("choosePlanCta");
    if (isCurrentPlan && isCancellationScheduled) {
      actionLabel = cancellationLabel;
    } else if (isCurrentPlan) {
      actionLabel = tSubscriptions("currentPlanCta");
    }

    return {
      actionLabel,
      creditsText: t("includedCreditsPerSeat", {
        credits: plan.credits,
      }),
      isDisabled:
        pendingPlan !== null || isCurrentPlan || !isCheckoutSeatsValid,
      isPlanPending: pendingPlan === plan.name,
    };
  }

  return (
    <div className="space-y-6">
      {hasCurrentPaidPlan ? (
        <OrganizationSeatsCard
          assignedCount={assignedCount}
          currentSeats={currentSeats}
          onError={handleSubscriptionActionError}
          organizationId={organizationId}
          scheduledCancelDate={scheduledCancelDate}
          scheduledSeats={scheduledSeats}
          scheduledSeatsAt={scheduledSeatsAt}
        />
      ) : null}
      {!hasCurrentPaidPlan && !showEnterpriseExclusiveUi ? (
        <Card>
          <CardContent className="space-y-6">
            <OrganizationSeatSettingsFields
              inputId="organization-seats"
              memberCount={memberCount}
              onTargetSeatsChange={setTargetSeats}
              targetSeats={targetSeats}
            />
          </CardContent>
        </Card>
      ) : null}
      <div className="space-y-4">
        {showEnterpriseExclusiveUi ? (
          <SubscriptionEnterprisePlanCard isCurrent />
        ) : (
          <>
            {showEnterprisePostTermUi ? (
              <SubscriptionEnterprisePlanCard isCurrent />
            ) : null}
            <div
              className={cn(
                "grid gap-4 md:grid-cols-2",
                // Enterprise contracts drop the Enterprise card, leaving 3.
                isEnterpriseContract ? "2xl:grid-cols-3" : "2xl:grid-cols-4",
              )}
            >
              {paidPlans.map((plan) => {
                const planPresentationProps = getPlanPresentationProps(plan);

                return (
                  <SubscriptionPlanCard
                    key={plan.name}
                    {...planPresentationProps}
                    isAnyPlanPending={pendingPlan !== null}
                    onAction={handleUpgradePlan}
                    plan={plan}
                  />
                );
              })}
              {!isEnterpriseContract ? (
                <SubscriptionEnterprisePlanCard />
              ) : null}
            </div>

            {freePlan ? <SubscriptionFreePlanRow plan={freePlan} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

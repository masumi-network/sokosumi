"use client";

import type {
  OrganizationBillingPlanName,
  PaidSubscriptionPlanName,
} from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { CommonErrorCode } from "@/lib/actions/errors";
import { OrganizationErrorCode } from "@/lib/actions/errors/error-codes";
import {
  updateOrganizationSubscriptionSeats,
  upgradeOrganizationSubscription,
} from "@/lib/actions/subscription";
import { fireGTMEvent } from "@/lib/gtm-events";
import {
  OrganizationSeatSettingsFields,
  resolveMinimumOrganizationSeats,
  resolveTargetOrganizationSeats,
} from "./organization-seat-settings-fields";
import { SubscriptionEnterprisePlanCard } from "./subscription-enterprise-plan-card";
import { SubscriptionFreePlanRow } from "./subscription-free-plan-row";
import { SubscriptionPlanCard } from "./subscription-plan-card";
import {
  type SubscriptionPlanView,
  splitSubscriptionPlans,
} from "./subscription-plan-utils";

interface OrganizationSubscriptionSectionProps {
  assignedSeatCount: number;
  cancelAtPeriodEnd: boolean;
  currentPlan: OrganizationBillingPlanName;
  currentPeriodEnd: Date | string | null;
  currentSeats: number;
  isEnterpriseConsumable: boolean;
  isEnterpriseContract: boolean;
  memberCount: number;
  organizationId: string;
  plans: SubscriptionPlanView[];
  returnPath: string;
}

export function OrganizationSubscriptionSection({
  assignedSeatCount,
  cancelAtPeriodEnd,
  currentPlan,
  currentPeriodEnd,
  currentSeats,
  isEnterpriseConsumable,
  isEnterpriseContract,
  memberCount,
  organizationId,
  plans,
  returnPath,
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

  const minimumSeats = useMemo(
    () => resolveMinimumOrganizationSeats(assignedSeatCount),
    [assignedSeatCount],
  );
  const [targetSeats, setTargetSeats] = useState(
    resolveTargetOrganizationSeats(currentSeats, assignedSeatCount),
  );
  const [pendingPlan, setPendingPlan] =
    useState<PaidSubscriptionPlanName | null>(null);

  useEffect(() => {
    setTargetSeats(
      resolveTargetOrganizationSeats(currentSeats, assignedSeatCount),
    );
  }, [assignedSeatCount, currentSeats]);

  const cancellationDate = useMemo(() => {
    if (!cancelAtPeriodEnd || !currentPeriodEnd) {
      return null;
    }

    const date =
      currentPeriodEnd instanceof Date
        ? currentPeriodEnd
        : new Date(currentPeriodEnd);

    return formatter.dateTime(date, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }, [cancelAtPeriodEnd, currentPeriodEnd, formatter]);

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

  const handleOpenLogin = useCallback(() => {
    router.push("/login");
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
    (error: { code: string; message?: string | null }) => {
      if (error.code === CommonErrorCode.UNAUTHENTICATED) {
        toast.error(t("Errors.unauthenticated"), {
          action: {
            label: t("Errors.unauthenticatedAction"),
            onClick: handleOpenLogin,
          },
        });
        return;
      }

      toast.error(getSubscriptionActionErrorMessage(error));
    },
    [getSubscriptionActionErrorMessage, handleOpenLogin, t],
  );

  const handleUpgradePlan = useCallback(
    async (planName: PaidSubscriptionPlanName) => {
      if (!Number.isInteger(targetSeats) || targetSeats < minimumSeats) {
        toast.error(t("Errors.badInput"));
        return;
      }

      setPendingPlan(planName);
      try {
        const isCurrentPlan = currentPlan === planName;
        const isSeatOnlyUpdate = isCurrentPlan && currentSeats !== targetSeats;

        if (isSeatOnlyUpdate) {
          const seatUpdateResult = await updateOrganizationSubscriptionSeats({
            organizationId,
            seats: targetSeats,
          });
          if (!seatUpdateResult.ok) {
            handleSubscriptionActionError(seatUpdateResult.error);
            return;
          }

          toast.success(t("seatsUpdatedSuccess"));
          router.refresh();
          return;
        }

        const result = await upgradeOrganizationSubscription({
          organizationId,
          plan: planName,
          returnPath,
          seats: targetSeats,
        });
        if (!result.ok) {
          handleSubscriptionActionError(result.error);
          return;
        }

        if (result.value.mode === "redirect") {
          fireGTMEvent.beginCheckout({ plan: planName, seats: targetSeats });
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
      currentPlan,
      handleSubscriptionActionError,
      currentSeats,
      minimumSeats,
      organizationId,
      returnPath,
      router,
      t,
      targetSeats,
    ],
  );

  function getPlanPresentationProps(plan: SubscriptionPlanView) {
    const isCurrentPlan = plan.isCurrent;
    const hasSamePlanAndSeats = isCurrentPlan && currentSeats === targetSeats;

    let actionLabel: null | string = t("choosePlanCta");
    if (isCurrentPlan && cancelAtPeriodEnd) {
      actionLabel = cancellationLabel;
    } else if (isCurrentPlan && !hasSamePlanAndSeats) {
      actionLabel = t("updateSeatsCta");
    } else if (isCurrentPlan) {
      actionLabel = tSubscriptions("currentPlanCta");
    }

    return {
      actionLabel,
      creditsText: t("includedCreditsPerSeat", {
        credits: plan.credits,
      }),
      isDisabled:
        pendingPlan !== null ||
        (isCurrentPlan && cancelAtPeriodEnd) ||
        (isCurrentPlan && hasSamePlanAndSeats) ||
        targetSeats < minimumSeats,
      isPlanPending: pendingPlan === plan.name,
      loadingLabel: t("updating"),
    };
  }

  return (
    <div className="space-y-6">
      {!showEnterpriseExclusiveUi ? (
        <Card>
          <CardContent className="space-y-6">
            <OrganizationSeatSettingsFields
              assignedSeatCount={assignedSeatCount}
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
            <div className="grid gap-4 md:grid-cols-2">
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

            {freePlan ? (
              <SubscriptionFreePlanRow
                creditsText={t("includedCreditsPerSeat", {
                  credits: freePlan.credits,
                })}
                plan={freePlan}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

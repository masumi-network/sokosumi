"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CommonErrorCode } from "@/lib/actions";
import {
  openOrganizationBillingPortal,
  updateOrganizationSubscriptionSeats,
  upgradeOrganizationSubscription,
} from "@/lib/actions/subscription";
import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";

import { SubscriptionPlanCard } from "./subscription-plan-card";
import {
  getPlanTranslationKey,
  type SubscriptionPlanView,
} from "./subscription-plan-utils";

interface OrganizationSubscriptionSectionProps {
  currentPlan: SubscriptionPlanName | null;
  currentSeats: number;
  memberCount: number;
  organizationId: string;
  plans: SubscriptionPlanView[];
  returnPath: string;
  showBillingPortalButton?: boolean;
}

export function OrganizationSubscriptionSection({
  currentPlan,
  currentSeats,
  memberCount,
  organizationId,
  plans,
  returnPath,
  showBillingPortalButton = true,
}: OrganizationSubscriptionSectionProps) {
  const t = useTranslations(
    "App.Organizations.OrganizationDetail.Subscription",
  );
  const tSubscriptions = useTranslations("App.Subscriptions");
  const router = useRouter();

  const minimumSeats = useMemo(() => Math.max(memberCount, 1), [memberCount]);
  const [targetSeats, setTargetSeats] = useState(
    Math.max(currentSeats, minimumSeats),
  );
  const [pendingPlan, setPendingPlan] = useState<SubscriptionPlanName | null>(
    null,
  );
  const [isBillingPortalPending, setIsBillingPortalPending] = useState(false);

  useEffect(() => {
    setTargetSeats(Math.max(currentSeats, minimumSeats));
  }, [currentSeats, minimumSeats]);

  const handleOpenLogin = useCallback(() => {
    router.push("/login");
  }, [router]);

  const getSubscriptionActionErrorMessage = useCallback(
    (error: { code: string; message?: string | null }): string => {
      if (error.message) {
        return error.message;
      }

      switch (error.code) {
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

  const getPlanActionLabel = useCallback(
    (plan: SubscriptionPlanView, hasSamePlanAndSeats: boolean) => {
      if (hasSamePlanAndSeats) {
        return t("currentPlanCta");
      }

      if (plan.isCurrent) {
        return t("updateSeatsCta");
      }

      return t("choosePlanCta");
    },
    [t],
  );

  const handleUpgradePlan = useCallback(
    async (planName: SubscriptionPlanName) => {
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

        window.location.href = result.data.url;
      } finally {
        setPendingPlan(null);
      }
    },
    [
      currentPlan,
      currentSeats,
      handleSubscriptionActionError,
      minimumSeats,
      organizationId,
      returnPath,
      router,
      t,
      targetSeats,
    ],
  );

  const handleOpenBillingPortal = useCallback(async () => {
    setIsBillingPortalPending(true);
    try {
      const result = await openOrganizationBillingPortal({
        organizationId,
        returnPath,
      });
      if (!result.ok) {
        handleSubscriptionActionError(result.error);
        return;
      }

      window.location.href = result.data.url;
    } finally {
      setIsBillingPortalPending(false);
    }
  }, [handleSubscriptionActionError, organizationId, returnPath]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div>
              <p className="text-muted-foreground">{t("currentPlanLabel")}</p>
              <p className="font-medium">
                {currentPlan
                  ? tSubscriptions(
                      `Plans.${getPlanTranslationKey(currentPlan)}.name`,
                    )
                  : t("noActivePlan")}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("currentSeatsLabel")}</p>
              <p className="font-medium">{currentSeats}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("membersLabel")}</p>
              <p className="font-medium">{memberCount}</p>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="organization-seats" className="text-sm font-medium">
              {t("seatsInputLabel")}
            </label>
            <Input
              id="organization-seats"
              type="number"
              min={minimumSeats}
              value={targetSeats}
              onChange={(event) => {
                const parsedValue = Number.parseInt(event.target.value, 10);
                if (Number.isNaN(parsedValue)) return;
                setTargetSeats(parsedValue);
              }}
            />
            <p className="text-muted-foreground text-xs">
              {t("seatsInputHint", { minimum: minimumSeats })}
            </p>
          </div>

          {showBillingPortalButton ? (
            <div className="flex justify-end">
              <Button
                variant="outline"
                disabled={isBillingPortalPending}
                onClick={() => {
                  void handleOpenBillingPortal();
                }}
              >
                {isBillingPortalPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t("openingBillingPortal")}
                  </>
                ) : (
                  t("billingPortalCta")
                )}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((plan) => {
          const isPlanPending = pendingPlan === plan.name;
          const hasSamePlanAndSeats =
            plan.isCurrent && currentSeats === targetSeats;

          return (
            <SubscriptionPlanCard
              key={plan.name}
              actionLabel={getPlanActionLabel(plan, hasSamePlanAndSeats)}
              creditsText={t("includedCreditsPerSeat", {
                credits: plan.credits,
              })}
              isAnyPlanPending={pendingPlan !== null}
              isDisabled={
                pendingPlan !== null ||
                hasSamePlanAndSeats ||
                targetSeats < minimumSeats
              }
              isPlanPending={isPlanPending}
              loadingLabel={t("updating")}
              onUpgrade={(nextPlan) => {
                void handleUpgradePlan(nextPlan);
              }}
              plan={plan}
            />
          );
        })}
      </div>
    </div>
  );
}

"use client";

import type {
  PaidSubscriptionPlanName,
  SubscriptionPlanName,
} from "@sokosumi/utils";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PurchaseSuccessModal } from "@/components/billing/purchase-success-modal";
import { CommonErrorCode } from "@/lib/actions/errors";
import { upgradePersonalSubscription } from "@/lib/actions/subscription";
import type { CoworkerOption } from "@/lib/types/coworker";

import { SubscriptionFreePlanRow } from "./subscription-free-plan-row";
import { SubscriptionPlanCard } from "./subscription-plan-card";
import {
  getPlanTranslationKey,
  type SubscriptionPlanView,
  splitSubscriptionPlans,
} from "./subscription-plan-utils";

interface PersonalSubscriptionSectionProps {
  cancelAtPeriodEnd: boolean;
  coworkersPromise: Promise<CoworkerOption[]>;
  currentPeriodEnd: Date | string | null;
  plans: SubscriptionPlanView[];
  returnPath?: string;
  status: "cancel" | "success" | null;
}

export function PersonalSubscriptionSection({
  cancelAtPeriodEnd,
  coworkersPromise,
  currentPeriodEnd,
  plans,
  returnPath,
  status,
}: PersonalSubscriptionSectionProps) {
  const t = useTranslations("App.Subscriptions");
  const tPurchaseSuccess = useTranslations("App.Billing.PurchaseSuccess");
  const formatter = useFormatter();
  const router = useRouter();
  const { freePlan, paidPlans } = useMemo(
    () => splitSubscriptionPlans(plans),
    [plans],
  );
  const [pendingPlan, setPendingPlan] = useState<SubscriptionPlanName | null>(
    null,
  );
  const [successModalOpen, setSuccessModalOpen] = useState(
    status === "success",
  );

  const currentPlanName = useMemo(() => {
    const currentPlan = plans.find((plan) => plan.isCurrent);
    return currentPlan
      ? t(`Plans.${getPlanTranslationKey(currentPlan.name)}.name`)
      : "";
  }, [plans, t]);

  const statusMessage = status === "cancel" ? t("statusCancel") : null;

  function handleSuccessModalOpenChange(open: boolean) {
    setSuccessModalOpen(open);
    if (!open) {
      router.replace(returnPath ?? "/billing?tab=subscription");
    }
  }

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

    return t("cancelsOnDate", {
      date: cancellationDate,
    });
  }, [cancellationDate, t]);

  async function handlePlanAction(plan: PaidSubscriptionPlanName) {
    setPendingPlan(plan);
    try {
      const result = await upgradePersonalSubscription({
        plan,
        returnPath,
      });

      if (!result.ok) {
        switch (result.error.code) {
          case CommonErrorCode.UNAUTHENTICATED:
            toast.error(t("Errors.unauthenticated"), {
              action: {
                label: t("Errors.unauthenticatedAction"),
                onClick: () => {
                  router.push("/login");
                },
              },
            });
            break;
          case CommonErrorCode.BAD_INPUT:
            toast.error(t("Errors.badInput"));
            break;
          default:
            toast.error(t("Errors.general"));
            break;
        }
        return;
      }

      if (result.data.mode === "redirect") {
        window.location.href = result.data.url;
        return;
      }

      toast.success(t("statusSuccess"));
      router.refresh();
    } finally {
      setPendingPlan(null);
    }
  }

  return (
    <div className="space-y-8">
      {statusMessage ? (
        <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-md px-4 py-3 text-sm">
          <CheckCircle2 className="size-4" />
          <span>{statusMessage}</span>
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {paidPlans.map((plan) => (
            <SubscriptionPlanCard
              key={plan.name}
              actionLabel={
                plan.isCurrent
                  ? (cancellationLabel ?? t("currentPlanCta"))
                  : t("upgradePlanCta")
              }
              isDisabled={pendingPlan !== null || plan.isCurrent}
              isAnyPlanPending={pendingPlan !== null}
              isPlanPending={pendingPlan === plan.name}
              loadingLabel={t("upgrading")}
              onAction={handlePlanAction}
              plan={plan}
            />
          ))}
        </div>

        {freePlan ? <SubscriptionFreePlanRow plan={freePlan} /> : null}
      </div>

      <PurchaseSuccessModal
        open={successModalOpen}
        onOpenChange={handleSuccessModalOpenChange}
        headline={tPurchaseSuccess("subscriptionTitle", {
          plan: currentPlanName,
        })}
        description={tPurchaseSuccess("subscriptionDescription")}
        coworkersPromise={coworkersPromise}
      />
    </div>
  );
}

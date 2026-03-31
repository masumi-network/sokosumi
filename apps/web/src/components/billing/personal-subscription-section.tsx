"use client";

import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { CommonErrorCode } from "@/lib/actions";
import { upgradePersonalSubscription } from "@/lib/actions/subscription";
import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";

import { SubscriptionFreePlanRow } from "./subscription-free-plan-row";
import { SubscriptionPlanCard } from "./subscription-plan-card";
import {
  type SubscriptionPlanView,
  splitSubscriptionPlans,
} from "./subscription-plan-utils";

interface PersonalSubscriptionSectionProps {
  plans: SubscriptionPlanView[];
  returnPath?: string;
  status: "cancel" | "success" | null;
}

export function PersonalSubscriptionSection({
  plans,
  returnPath,
  status,
}: PersonalSubscriptionSectionProps) {
  const t = useTranslations("App.Subscriptions");
  const router = useRouter();
  const { freePlan, paidPlans } = useMemo(
    () => splitSubscriptionPlans(plans),
    [plans],
  );
  const [pendingPlan, setPendingPlan] = useState<SubscriptionPlanName | null>(
    null,
  );

  const statusMessage = useMemo(() => {
    if (status === "success") {
      return t("statusSuccess");
    }
    if (status === "cancel") {
      return t("statusCancel");
    }
    return null;
  }, [status, t]);

  async function handleUpgradePlan(plan: SubscriptionPlanName) {
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

      window.location.href = result.data.url;
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
              isAnyPlanPending={pendingPlan !== null}
              isPlanPending={pendingPlan === plan.name}
              onUpgrade={(nextPlan) => {
                void handleUpgradePlan(nextPlan);
              }}
              plan={plan}
            />
          ))}
        </div>

        {freePlan ? (
          <SubscriptionFreePlanRow
            isAnyPlanPending={pendingPlan !== null}
            isPlanPending={pendingPlan === freePlan.name}
            onUpgrade={(nextPlan) => {
              void handleUpgradePlan(nextPlan);
            }}
            plan={freePlan}
          />
        ) : null}
      </div>
    </div>
  );
}

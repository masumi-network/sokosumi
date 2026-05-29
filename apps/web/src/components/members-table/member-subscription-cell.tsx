"use client";

import { useTranslations } from "next-intl";

import { getPlanTranslationKey } from "@/components/billing/subscription-plan-utils";
import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";

interface MemberSubscriptionCellProps {
  hasPaidSeat: boolean;
  paidPlan: SubscriptionPlanName | null;
}

export function MemberSubscriptionCell({
  hasPaidSeat,
  paidPlan,
}: MemberSubscriptionCellProps) {
  const tPlans = useTranslations("App.Subscriptions");
  const isPaidSeat = hasPaidSeat && paidPlan !== null;
  const plan: SubscriptionPlanName = isPaidSeat ? paidPlan : "free";
  const label = tPlans(`Plans.${getPlanTranslationKey(plan)}.name`);

  return (
    <div className="p-2">
      <span
        className={
          isPaidSeat
            ? "bg-primary/10 text-primary inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
            : "bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
        }
      >
        {label}
      </span>
    </div>
  );
}

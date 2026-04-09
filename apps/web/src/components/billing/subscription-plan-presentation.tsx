"use client";

import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";

interface FormatPlanPriceParams {
  formatCurrency: (amount: number) => string;
  freePriceLabel: string;
  monthlyAmount: number;
}

interface SubscriptionPlanActionButtonProps {
  actionLabel: null | string;
  disabled: boolean;
  isCurrent: boolean;
  isPlanPending: boolean;
  loadingLabel: string;
  onAction: (plan: SubscriptionPlanName) => void;
  planName: SubscriptionPlanName;
}

interface SubscriptionPlanFeatureListProps {
  items: string[];
  title: string;
}

export function resolvePlanFeatureItems(rawItems: unknown): string[] {
  if (
    rawItems === null ||
    typeof rawItems !== "object" ||
    Array.isArray(rawItems)
  ) {
    return [];
  }

  return Object.values(rawItems).filter(
    (item): item is string => typeof item === "string",
  );
}

export function formatPlanPrice({
  formatCurrency,
  freePriceLabel,
  monthlyAmount,
}: FormatPlanPriceParams): string {
  if (monthlyAmount === 0) {
    return freePriceLabel;
  }

  return formatCurrency(monthlyAmount / 100);
}

export function SubscriptionPlanFeatureList({
  items,
  title,
}: SubscriptionPlanFeatureListProps) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-semibold">{title}</p>
      <ul className="space-y-2 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <Check className="text-primary mt-0.5 size-4" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SubscriptionPlanActionButton({
  actionLabel,
  disabled,
  isCurrent,
  isPlanPending,
  loadingLabel,
  onAction,
  planName,
}: SubscriptionPlanActionButtonProps) {
  if (!actionLabel) {
    return null;
  }

  return (
    <Button
      className="w-full"
      variant={isCurrent ? "outline" : "default"}
      disabled={disabled}
      onClick={() => onAction(planName)}
    >
      {isPlanPending ? (
        <>
          <Loader2 className="mr-2 size-4 animate-spin" />
          {loadingLabel}
        </>
      ) : (
        actionLabel
      )}
    </Button>
  );
}

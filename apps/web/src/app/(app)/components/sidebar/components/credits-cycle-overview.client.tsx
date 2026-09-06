"use client";

import { useTranslations } from "next-intl";
import type { ReactElement } from "react";
import { Progress } from "@/components/ui/progress";
import type { CreditUsage } from "@/lib/types/credit";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

import { resolveCreditRenewalKind } from "./account-summary-labels";

export interface CreditsCycleOverviewProps {
  creditUsage: CreditUsage | null;
  subscriptionPeriodEndMs: number | null;
  currentTimestampMs: number;
  headingId?: string;
}

export function CreditsCycleOverview({
  creditUsage,
  subscriptionPeriodEndMs,
  currentTimestampMs,
  headingId,
}: CreditsCycleOverviewProps): ReactElement | null {
  const tCredit = useTranslations("Components.UserAvatar");

  if (creditUsage === null) {
    return null;
  }

  const remaining = formatCreditsForDisplay(creditUsage.remaining);
  const total = formatCreditsForDisplay(creditUsage.total);
  const exhausted = remaining <= 0;
  const remainingPercent =
    total <= 0 ? 0 : Math.min(Math.max((remaining / total) * 100, 0), 100);

  const renewal = resolveCreditRenewalKind(
    subscriptionPeriodEndMs,
    currentTimestampMs,
  );
  let renewalLabel: string | null = null;
  if (renewal !== null) {
    switch (renewal.kind) {
      case "expired":
        renewalLabel = tCredit("creditsExpired");
        break;
      case "today":
        renewalLabel = tCredit("creditsExpiresToday");
        break;
      case "inDays":
        renewalLabel = tCredit("creditsExpiresInDays", { days: renewal.days });
        break;
      default: {
        const _exhaustive: never = renewal;
        return _exhaustive;
      }
    }
  }

  return (
    <div className="space-y-1.5" data-testid="credits-cycle-overview">
      <p id={headingId} className="text-xs font-medium">
        {tCredit("monthlyUsageLimit")}
      </p>
      {exhausted ? (
        <p
          className="text-sm leading-snug font-medium"
          data-testid="credits-cycle-exhausted"
        >
          {tCredit("planAllowanceExhausted")}
        </p>
      ) : (
        <p className="text-lg leading-none font-semibold tracking-tight tabular-nums">
          {tCredit("creditsRemainingHero", { credits: remaining })}
        </p>
      )}
      <Progress
        className="bg-primary/20 h-1.5"
        value={remainingPercent}
        aria-label={tCredit("creditsAllowanceProgressAria")}
      />
      <p className="text-muted-foreground text-xs">
        {tCredit("creditsRemainingOfTotal", { remaining, total })}
      </p>
      {renewalLabel !== null ? (
        <p className="text-muted-foreground text-xs">{renewalLabel}</p>
      ) : null}
    </div>
  );
}

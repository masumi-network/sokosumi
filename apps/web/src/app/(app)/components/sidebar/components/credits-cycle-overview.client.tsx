"use client";

import { useTranslations } from "next-intl";
import type { ReactElement } from "react";
import { Progress } from "@/components/ui/progress";
import type { CreditUsage } from "@/lib/types/credit";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

import { resolveCreditRenewalKind } from "./account-summary-labels";

export interface CreditsCycleOverviewProps {
  creditUsage: CreditUsage | null;
  extraCredits: number | null;
  subscriptionPeriodEndMs: number | null;
  currentTimestampMs: number;
  headingId?: string;
}

function additionalCreditsDisplay(extraCredits: number | null): number | null {
  if (extraCredits === null) {
    return null;
  }
  const formatted = formatCreditsForDisplay(extraCredits);
  return formatted > 0 ? formatted : null;
}

export function CreditsCycleOverview({
  creditUsage,
  extraCredits,
  subscriptionPeriodEndMs,
  currentTimestampMs,
  headingId,
}: CreditsCycleOverviewProps): ReactElement | null {
  const tCredit = useTranslations("Components.UserAvatar");

  const formattedExtra = additionalCreditsDisplay(extraCredits);
  if (formattedExtra === null && creditUsage === null) {
    return null;
  }

  let monthly: ReactElement | null = null;
  if (creditUsage !== null) {
    const remaining = formatCreditsForDisplay(creditUsage.remaining);
    const cycleTotal = formatCreditsForDisplay(creditUsage.total);
    const remainingPercent =
      cycleTotal <= 0
        ? 0
        : Math.min(Math.max((remaining / cycleTotal) * 100, 0), 100);

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
          renewalLabel = tCredit("creditsExpiresInDays", {
            days: renewal.days,
          });
          break;
        default: {
          const _exhaustive: never = renewal;
          return _exhaustive;
        }
      }
    }

    monthly = (
      <div className="space-y-1">
        <p id={headingId} className="text-muted-foreground text-xs font-medium">
          {tCredit("monthlyUsageLimit")}
        </p>
        {remaining > 0 ? (
          <p className="text-sm leading-tight tabular-nums">
            {tCredit("creditsRemainingHero", { credits: remaining })}
          </p>
        ) : null}
        <Progress
          className="bg-primary-quaternary h-1.5"
          value={remainingPercent}
          aria-label={tCredit("creditsAllowanceProgressAria")}
        />
        <p className="text-muted-foreground text-xs">
          {tCredit("creditsRemainingOfTotal", {
            remaining,
            total: cycleTotal,
          })}
        </p>
        {renewalLabel !== null ? (
          <p className="text-muted-foreground text-xs">{renewalLabel}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="credits-cycle-overview">
      {monthly}
      {monthly !== null && formattedExtra !== null ? (
        <div
          className="bg-border h-px"
          data-testid="credits-overview-separator"
        />
      ) : null}
      {formattedExtra !== null ? (
        <div className="space-y-1" data-testid="credits-additional">
          <p
            id={monthly === null ? headingId : undefined}
            className="text-muted-foreground text-xs font-medium"
          >
            {tCredit("additionalCreditsLabel")}
          </p>
          <p className="text-muted-foreground text-sm leading-tight tabular-nums">
            {tCredit("additionalCreditsHero", {
              credits: formattedExtra,
            })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

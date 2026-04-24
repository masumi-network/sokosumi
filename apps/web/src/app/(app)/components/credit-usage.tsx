"use client";

import { useTranslations } from "next-intl";

import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CreditUsage as CreditUsageType } from "@/lib/types/credit";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

interface CreditUsageProps {
  creditUsage?: CreditUsageType | null;
  extraCredits?: number | null;
  creditsLabel?: string;
  currentTimestampMs: number;
  subscriptionPeriodEndMs?: number | null;
}

export default function CreditUsage({
  creditUsage,
  extraCredits,
  creditsLabel,
  currentTimestampMs,
  subscriptionPeriodEndMs,
}: CreditUsageProps) {
  const t = useTranslations("Components.UserAvatar");
  const tBilling = useTranslations("App.Billing");
  const activeCreditUsage = creditUsage?.hasUsageData ? creditUsage : null;

  if (!activeCreditUsage) {
    return null;
  }

  const creditUsageAriaLabel = t("creditsConsumedProgressAria");
  const creditUsageLabel = t("creditsUsedOfTotal", {
    used: formatCreditsForDisplay(activeCreditUsage.used),
    total: formatCreditsForDisplay(activeCreditUsage.total),
  });
  const hasExtraCredits = (extraCredits ?? 0) > 0;
  const totalCreditsNumeric = formatCreditsForDisplay(
    activeCreditUsage.remaining + Math.max(0, extraCredits ?? 0),
  );
  const totalCreditsDisplay = tBilling("balanceCreditsLabel", {
    credits: totalCreditsNumeric,
  });
  let creditsExpiryLabel: string | null = null;
  if (subscriptionPeriodEndMs) {
    const millisecondsPerDay = 1000 * 60 * 60 * 24;
    const millisecondsUntilExpiry =
      subscriptionPeriodEndMs - currentTimestampMs;

    if (millisecondsUntilExpiry < 0) {
      creditsExpiryLabel = t("creditsExpired");
    } else if (millisecondsUntilExpiry < millisecondsPerDay) {
      creditsExpiryLabel = t("creditsExpiresToday");
    } else {
      const daysUntilExpiry = Math.ceil(
        millisecondsUntilExpiry / millisecondsPerDay,
      );
      creditsExpiryLabel = t("creditsExpiresInDays", { days: daysUntilExpiry });
    }
  }

  if (creditsLabel) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <div className="w-full min-w-28 space-y-1">
              {creditsExpiryLabel ? (
                <div className="text-muted-foreground w-fit text-xs font-semibold">
                  {creditsExpiryLabel}
                </div>
              ) : null}
              <Progress
                className="h-1.5"
                value={activeCreditUsage.percentageUsed}
                aria-label={creditUsageAriaLabel}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="bg-popover text-popover-foreground min-w-56 rounded-md border p-3 shadow-md"
            arrowClassName="mt-0.5 bg-popover fill-popover border-b border-r"
          >
            <div className="space-y-3 text-left">
              <section className="space-y-1">
                <p className="text-lg font-bold tabular-nums leading-none tracking-tight">
                  {totalCreditsDisplay}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("totalBalanceLabel")}
                </p>
              </section>
              <div className="bg-border h-px" />
              <section className="space-y-1.5">
                <p className="text-xs font-semibold">
                  {t("monthlyUsageLimit")}
                </p>
                <div className="bg-primary/20 relative h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    role="progressbar"
                    aria-label={creditUsageAriaLabel}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={activeCreditUsage.percentageUsed}
                    className="bg-primary h-full transition-all"
                    style={{ width: `${activeCreditUsage.percentageUsed}%` }}
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  {creditUsageLabel}
                </p>
                {creditsExpiryLabel ? (
                  <p className="text-muted-foreground text-xs">
                    {creditsExpiryLabel}
                  </p>
                ) : null}
              </section>
              {hasExtraCredits ? (
                <>
                  <div className="bg-border h-px" />
                  <section className="space-y-1">
                    <p className="text-muted-foreground text-xs">
                      {t("extraCredits")}
                    </p>
                    <p className="text-lg font-bold tabular-nums leading-none tracking-tight">
                      {creditsLabel}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t("extraCreditsDescription")}
                    </p>
                  </section>
                </>
              ) : null}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="w-full min-w-28 space-y-1">
      {creditsExpiryLabel ? (
        <div className="text-muted-foreground w-fit text-[11px]">
          {creditsExpiryLabel}
        </div>
      ) : null}
      <Progress
        className="h-1.5"
        value={activeCreditUsage.percentageUsed}
        aria-label={creditUsageAriaLabel}
      />
      <div className="text-muted-foreground w-fit text-[11px]">
        {creditUsageLabel}
      </div>
    </div>
  );
}

"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import type { CreditUsage as CreditUsageType } from "@/lib/types/credit";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

interface CreditUsageProps {
  creditUsage?: CreditUsageType | null;
  extraCredits?: number | null;
  creditsLabel?: string;
  currentTimestampMs: number;
  subscriptionPeriodEndMs?: number | null;
  isLowCredits?: boolean;
}

export default function CreditUsage({
  creditUsage,
  extraCredits,
  creditsLabel,
  currentTimestampMs,
  subscriptionPeriodEndMs,
  isLowCredits = false,
}: CreditUsageProps) {
  const t = useTranslations("Components.UserAvatar");
  const tBilling = useTranslations("App.Billing");
  const activeCreditUsage = creditUsage?.hasUsageData ? creditUsage : null;

  if (!activeCreditUsage) {
    return null;
  }

  const creditUsageAriaLabel = t("creditsConsumedProgressAria");
  const usedFormatted = formatCreditsForDisplay(activeCreditUsage.used);
  const totalFormatted = formatCreditsForDisplay(activeCreditUsage.total);
  const hasExtraCredits = (extraCredits ?? 0) > 0;
  const totalCreditsNumeric = formatCreditsForDisplay(
    activeCreditUsage.remaining + Math.max(0, extraCredits ?? 0),
  );
  const totalCreditsDisplay = tBilling("balanceCreditsLabel", {
    credits: totalCreditsNumeric,
  });

  const normalCreditUsageLabel = t("creditsUsedOfTotal", {
    used: usedFormatted,
    total: totalFormatted,
  });

  const lowCreditUsageLabel = t("lowCreditsLabel", {
    credits: totalCreditsNumeric,
  });

  const triggerLabel = isLowCredits
    ? lowCreditUsageLabel
    : normalCreditUsageLabel;

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

  const progressRootClassName = isLowCredits
    ? "bg-semantic-warning/20 h-1.5"
    : "bg-primary/20 h-1.5";
  const progressIndicatorClassName = isLowCredits
    ? "bg-semantic-warning"
    : "bg-primary";

  if (creditsLabel) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <div className="group hover:bg-sidebar-accent focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent w-full min-w-28 cursor-pointer space-y-1 rounded-md px-2 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-hidden">
            <div className="text-muted-foreground group-hover:text-primary-foreground dark:group-hover:text-primary-foreground group-data-[state=open]:text-primary-foreground flex w-full items-center gap-1.5 text-xs font-semibold">
              {isLowCredits ? (
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              ) : null}
              <span className="min-w-0 truncate tabular-nums">
                {triggerLabel}
              </span>
              <ChevronDown
                className="ml-auto size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </div>
            <Progress
              className={progressRootClassName}
              value={activeCreditUsage.percentageUsed}
              aria-label={creditUsageAriaLabel}
              indicatorClassName={progressIndicatorClassName}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className="bg-popover text-popover-foreground min-w-56 rounded-md border p-3 shadow-md"
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
              <p className="text-xs font-semibold">{t("monthlyUsageLimit")}</p>
              <div className={progressRootClassName}>
                <div
                  role="progressbar"
                  aria-label={creditUsageAriaLabel}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={activeCreditUsage.percentageUsed}
                  className={`${progressIndicatorClassName} h-full transition-all`}
                  style={{ width: `${activeCreditUsage.percentageUsed}%` }}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {normalCreditUsageLabel}
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
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className="w-full min-w-28 space-y-1">
      <div className="text-muted-foreground flex w-fit items-center gap-1.5 text-[11px]">
        {isLowCredits ? (
          <AlertTriangle className="size-3.5" aria-hidden />
        ) : null}
        <span className="truncate tabular-nums">{triggerLabel}</span>
      </div>
      <Progress
        className={progressRootClassName}
        value={activeCreditUsage.percentageUsed}
        aria-label={creditUsageAriaLabel}
        indicatorClassName={progressIndicatorClassName}
      />
    </div>
  );
}

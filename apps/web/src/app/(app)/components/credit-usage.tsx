"use client";

import { useTranslations } from "next-intl";

import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CreditUsage as CreditUsageType } from "@/lib/types/credit";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

interface CreditUsageProps {
  creditUsage?: CreditUsageType | null;
  creditsLabel?: string;
  currentTimestampMs: number;
  subscriptionPeriodEndMs?: number | null;
}

export default function CreditUsage({
  creditUsage,
  creditsLabel,
  currentTimestampMs,
  subscriptionPeriodEndMs,
}: CreditUsageProps) {
  const t = useTranslations("Components.UserAvatar");
  const activeCreditUsage = creditUsage?.hasUsageData ? creditUsage : null;

  if (!activeCreditUsage) {
    return null;
  }

  const creditUsageAriaLabel = t("creditsConsumedProgressAria");
  const creditUsageLabel = t("creditsUsedOfTotal", {
    used: formatCreditsForDisplay(activeCreditUsage.used),
    total: formatCreditsForDisplay(activeCreditUsage.total),
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
          <TooltipContent side="bottom">
            <div className="gap-2">
              <p className="pb-1 font-semibold">{t("subscriptionUsage")}</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>{creditUsageLabel}</li>
                {creditsExpiryLabel ? <li>{creditsExpiryLabel}</li> : null}
              </ul>
              <p className="pt-2 pb-1 font-semibold">{t("extraCredits")}</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>{creditsLabel}</li>
                <li>{t("extraCreditsDescription")}</li>
              </ul>
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

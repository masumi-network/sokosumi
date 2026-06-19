"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CreditUsage as CreditUsageType } from "@/lib/types/credit";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

const CIRCULAR_PROGRESS_SIZE = 32;
const CIRCULAR_PROGRESS_STROKE = 3;

interface CircularCreditProgressProps {
  value: number;
  ariaLabel?: string;
  trackClassName: string;
  indicatorClassName: string;
  decorative?: boolean;
}

function CircularCreditProgress({
  value,
  ariaLabel,
  trackClassName,
  indicatorClassName,
  decorative = false,
}: CircularCreditProgressProps) {
  const radius = (CIRCULAR_PROGRESS_SIZE - CIRCULAR_PROGRESS_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (Math.min(Math.max(value, 0), 100) / 100) * circumference;
  const center = CIRCULAR_PROGRESS_SIZE / 2;

  return (
    <svg
      data-testid="circular-credit-progress"
      width={CIRCULAR_PROGRESS_SIZE}
      height={CIRCULAR_PROGRESS_SIZE}
      viewBox={`0 0 ${CIRCULAR_PROGRESS_SIZE} ${CIRCULAR_PROGRESS_SIZE}`}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : "progressbar"}
      aria-label={decorative ? undefined : ariaLabel}
      aria-valuemin={decorative ? undefined : 0}
      aria-valuemax={decorative ? undefined : 100}
      aria-valuenow={decorative ? undefined : value}
      className="shrink-0"
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={CIRCULAR_PROGRESS_STROKE}
        className={trackClassName}
        stroke="currentColor"
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={CIRCULAR_PROGRESS_STROKE}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        className={indicatorClassName}
        stroke="currentColor"
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}

interface CollapsedCreditsPopoverProps {
  triggerLabel: string;
  triggerClassName: string;
  tooltipLabel: string;
  popoverDetails: ReactNode;
  percentageUsed: number;
  circularTrackClassName: string;
  circularIndicatorClassName: string;
}

function CollapsedCreditsPopover({
  triggerLabel,
  triggerClassName,
  tooltipLabel,
  popoverDetails,
  percentageUsed,
  circularTrackClassName,
  circularIndicatorClassName,
}: CollapsedCreditsPopoverProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <div className="flex w-full justify-center">
      <Tooltip open={popoverOpen ? false : undefined}>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={triggerClassName}
                aria-label={triggerLabel}
              >
                <CircularCreditProgress
                  value={percentageUsed}
                  trackClassName={circularTrackClassName}
                  indicatorClassName={circularIndicatorClassName}
                  decorative
                />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <PopoverContent
            side="right"
            align="center"
            className="bg-popover text-popover-foreground min-w-56 rounded-md border p-3 shadow-md"
          >
            {popoverDetails}
          </PopoverContent>
        </Popover>
        <TooltipContent side="right" align="center">
          {tooltipLabel}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

interface CreditUsageProps {
  creditUsage?: CreditUsageType | null;
  extraCredits?: number | null;
  creditsLabel?: string;
  currentTimestampMs: number;
  subscriptionPeriodEndMs?: number | null;
  lowCreditsThreshold: number;
}

export default function CreditUsage({
  creditUsage,
  extraCredits,
  creditsLabel,
  currentTimestampMs,
  subscriptionPeriodEndMs,
  lowCreditsThreshold,
}: CreditUsageProps) {
  const t = useTranslations("Components.UserAvatar");
  const tBilling = useTranslations("App.Billing");
  const { isMobile, state } = useSidebar();
  const isCollapsed = !isMobile && state === "collapsed";
  const activeCreditUsage = creditUsage?.hasUsageData ? creditUsage : null;

  if (!activeCreditUsage) {
    return null;
  }

  const creditUsageAriaLabel = t("creditsConsumedProgressAria");
  const usedFormatted = formatCreditsForDisplay(activeCreditUsage.used);
  const totalFormatted = formatCreditsForDisplay(activeCreditUsage.total);
  const hasExtraCredits = (extraCredits ?? 0) > 0;
  const totalBalance =
    activeCreditUsage.remaining + Math.max(0, extraCredits ?? 0);
  const totalCreditsNumeric = formatCreditsForDisplay(totalBalance);
  const totalCreditsDisplay = tBilling("balanceCreditsLabel", {
    credits: totalCreditsNumeric,
  });
  const isLowCredits = totalBalance < lowCreditsThreshold && totalBalance > 0;

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
  const circularTrackClassName = isLowCredits
    ? "text-semantic-warning/20"
    : "text-primary/20";
  const circularIndicatorClassName = isLowCredits
    ? "text-semantic-warning"
    : "text-primary";

  const popoverDetails = (
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
        <Progress
          className={progressRootClassName}
          value={activeCreditUsage.percentageUsed}
          aria-label={creditUsageAriaLabel}
          indicatorClassName={progressIndicatorClassName}
        />
        <p className="text-muted-foreground text-xs">
          {normalCreditUsageLabel}
        </p>
        {creditsExpiryLabel ? (
          <p className="text-muted-foreground text-xs">{creditsExpiryLabel}</p>
        ) : null}
      </section>
      {hasExtraCredits ? (
        <>
          <div className="bg-border h-px" />
          <section className="space-y-1">
            <p className="text-muted-foreground text-xs">{t("extraCredits")}</p>
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
  );

  if (isCollapsed) {
    const collapsedTriggerClassName = cn(
      "hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-hidden",
      creditsLabel &&
        "group cursor-pointer data-[state=open]:bg-sidebar-accent",
    );

    if (creditsLabel) {
      return (
        <CollapsedCreditsPopover
          triggerLabel={triggerLabel}
          tooltipLabel={triggerLabel}
          triggerClassName={collapsedTriggerClassName}
          popoverDetails={popoverDetails}
          percentageUsed={activeCreditUsage.percentageUsed}
          circularTrackClassName={circularTrackClassName}
          circularIndicatorClassName={circularIndicatorClassName}
        />
      );
    }

    const circularProgress = (
      <CircularCreditProgress
        value={activeCreditUsage.percentageUsed}
        ariaLabel={creditUsageAriaLabel}
        trackClassName={circularTrackClassName}
        indicatorClassName={circularIndicatorClassName}
      />
    );

    return (
      <div className="flex w-full justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={collapsedTriggerClassName}>{circularProgress}</div>
          </TooltipTrigger>
          <TooltipContent side="right" align="center">
            {triggerLabel}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  if (creditsLabel) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={triggerLabel}
            className="group hover:bg-sidebar-accent focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent w-full min-w-28 cursor-pointer space-y-1 rounded-md px-2 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
          >
            <div className="text-muted-foreground group-hover:text-sidebar-accent-foreground group-data-[state=open]:text-sidebar-accent-foreground flex w-full items-center gap-1.5 text-xs font-semibold">
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
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className="bg-popover text-popover-foreground min-w-56 rounded-md border p-3 shadow-md"
        >
          {popoverDetails}
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

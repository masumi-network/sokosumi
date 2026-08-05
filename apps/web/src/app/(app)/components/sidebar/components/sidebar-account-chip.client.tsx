"use client";

import type { SessionUser } from "@sokosumi/utils";
import gravatarUrl from "gravatar-url";
import { AlertTriangle, ChevronDown, Coins, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { PresenceDot } from "@/components/chat/presence-dot";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { useSelfPresence } from "@/hooks/use-self-presence";
import type { CreditUsage } from "@/lib/types/credit";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { getInitials } from "@/lib/utils/text";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const GRAVATAR_SIZE = 80;

interface SidebarAccountChipProps {
  sessionUser: SessionUser;
  planName: string | null;
  totalCredits: number | null;
  extraCredits: number | null;
  creditUsage: CreditUsage | null;
  subscriptionPeriodEndMs: number | null;
  currentTimestampMs: number;
  lowCreditsThreshold: number;
  buyCreditsLabel: string;
  buyCreditsPath: string;
}

export function SidebarAccountChip({
  sessionUser,
  planName,
  totalCredits,
  extraCredits,
  creditUsage,
  subscriptionPeriodEndMs,
  currentTimestampMs,
  lowCreditsThreshold,
  buyCreditsLabel,
  buyCreditsPath,
}: SidebarAccountChipProps) {
  const t = useTranslations("App.Sidebar.Account");
  const tCredit = useTranslations("Components.UserAvatar");
  const tBilling = useTranslations("App.Billing");
  const tPresence = useTranslations("App.Channels.Presence");
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();
  const { showLogoutModal } = useGlobalModalsContext();
  const router = useRouter();
  const presence = useSelfPresence();
  const [isOpen, setIsOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );

  // The summary is portaled out of the sidebar, so it survives the trigger
  // moving under it — the rail collapsing, or the mobile sheet sliding shut
  // behind a tap on some other nav item. Close it whenever that happens.
  useEffect(() => {
    setIsOpen(false);
  }, [isMobile, state, openMobile]);

  const isCollapsed = !isMobile && state === "collapsed";
  const displayName = sessionUser.name.trim() || sessionUser.email;
  const presenceLabel = tPresence(presence);
  // Null means no metered subscription period — `resolveCreditUsage` only
  // returns a value when the period grants credits.
  const usage = creditUsage;

  const displayTotal =
    totalCredits === null ? null : formatCreditsForDisplay(totalCredits);
  const creditsLabel =
    displayTotal === null
      ? null
      : tBilling("balanceCreditsLabel", { credits: displayTotal });
  const isLowCredits =
    displayTotal !== null &&
    displayTotal > 0 &&
    displayTotal < lowCreditsThreshold;

  const summary =
    planName !== null && creditsLabel !== null
      ? t("planAndCredits", { plan: planName, credits: creditsLabel })
      : (creditsLabel ?? planName ?? t("detailsUnavailable"));

  const displayExtraCredits =
    extraCredits === null ? null : formatCreditsForDisplay(extraCredits);
  // Without a subscription period there is nothing else in the balance, so an
  // extra-credits block would just repeat the total.
  const showExtraCredits =
    usage !== null && displayExtraCredits !== null && displayExtraCredits > 0;

  function resolveRenewalLabel(): string | null {
    // `currentTimestampMs` comes from the credits response; without it every
    // renewal date would read as decades away.
    if (subscriptionPeriodEndMs === null || currentTimestampMs <= 0) {
      return null;
    }

    const remainingMs = subscriptionPeriodEndMs - currentTimestampMs;
    if (remainingMs < 0) {
      return tCredit("creditsExpired");
    }
    if (remainingMs < MILLISECONDS_PER_DAY) {
      return tCredit("creditsExpiresToday");
    }

    return tCredit("creditsExpiresInDays", {
      days: Math.ceil(remainingMs / MILLISECONDS_PER_DAY),
    });
  }

  // The mobile sidebar is a Sheet, and its scroll lock cancels every touchmove
  // that starts outside the sheet's own subtree (react-remove-scroll shards).
  // A summary portaled to <body> is outside it, so on a viewport too short for
  // the full panel the overflow below the fold could not be reached by finger.
  // Portaling into the sheet itself puts it back inside the allowlist; the
  // sheet is `fixed` at the viewport origin with visible overflow, so the
  // panel's position is unchanged.
  function handleOpenChange(open: boolean) {
    if (open) {
      setPortalContainer(
        isMobile
          ? document.querySelector<HTMLElement>(
              '[data-slot="sidebar"][data-mobile="true"]',
            )
          : null,
      );
    }

    setIsOpen(open);
  }

  function closeChip() {
    setIsOpen(false);
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  function handleBuyCredits() {
    closeChip();
    router.push(buyCreditsPath);
  }

  function handleLogout() {
    closeChip();
    showLogoutModal(sessionUser.email);
  }

  // The summary spells the status out in words right below, so only the
  // collapsed-to-a-row trigger carries the dot.
  function renderAvatar(options: { withPresenceDot: boolean }) {
    return (
      <span className="relative shrink-0">
        <Avatar className="size-8">
          <AvatarImage
            src={
              sessionUser.image ??
              gravatarUrl(sessionUser.email, {
                size: GRAVATAR_SIZE,
                default: "404",
              })
            }
            alt=""
          />
          <AvatarFallback className="bg-muted text-muted-foreground text-[0.6875rem] font-medium">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        {options.withPresenceDot ? (
          <PresenceDot
            presence={presence}
            label={presenceLabel}
            className="border-sidebar absolute -right-0.5 -bottom-0.5"
          />
        ) : null}
      </span>
    );
  }

  const renewalLabel = resolveRenewalLabel();

  const trigger = (
    <button
      type="button"
      aria-label={t("openSummary", { name: displayName, summary })}
      className={cn(
        "group/chip hover:bg-sidebar-accent focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent flex cursor-pointer items-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-hidden",
        isCollapsed ? "size-8 justify-center" : "w-full gap-2.5 p-2",
      )}
    >
      {renderAvatar({ withPresenceDot: true })}
      {isCollapsed ? null : (
        <>
          <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
            <span className="w-full truncate text-left text-sm leading-none font-medium">
              {displayName}
            </span>
            <span
              className={cn(
                "flex w-full items-center gap-1 text-xs leading-none",
                isLowCredits
                  ? "text-semantic-warning"
                  : "text-muted-foreground",
              )}
            >
              {isLowCredits ? (
                <AlertTriangle className="size-3 shrink-0" aria-hidden />
              ) : null}
              <span className="min-w-0 truncate tabular-nums">{summary}</span>
            </span>
          </span>
          <ChevronDown
            className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]/chip:rotate-180"
            aria-hidden
          />
        </>
      )}
    </button>
  );

  const details = (
    <div className="space-y-3 text-left">
      <div className="flex items-center gap-2.5">
        {renderAvatar({ withPresenceDot: false })}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-medium">
            {displayName}
          </p>
          <p className="text-muted-foreground truncate text-xs leading-tight">
            {sessionUser.email}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {/* Decorative here — the word next to it is the label, and a screen
              reader should not read the status twice. */}
          <span aria-hidden="true">
            <PresenceDot
              presence={presence}
              label={presenceLabel}
              className="size-2 border-0"
            />
          </span>
          {presenceLabel}
        </span>
        {planName !== null ? (
          <span className="bg-muted rounded-full px-2 py-0.5 text-[0.6875rem] font-medium">
            <span className="sr-only">{`${t("planLabel")}: `}</span>
            {planName}
          </span>
        ) : null}
      </div>
      <div className="bg-border h-px" />
      <div className="space-y-1">
        <p className="text-lg leading-none font-semibold tracking-tight tabular-nums">
          {creditsLabel ?? t("detailsUnavailable")}
        </p>
        <p className="text-muted-foreground text-xs">
          {tCredit("totalBalanceLabel")}
        </p>
      </div>
      {usage ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">{t("monthlyCredits")}</p>
          <Progress
            className={cn(
              "h-1.5",
              isLowCredits ? "bg-semantic-warning/20" : "bg-primary/20",
            )}
            value={usage.percentageUsed}
            aria-label={tCredit("creditsConsumedProgressAria")}
            indicatorClassName={
              isLowCredits ? "bg-semantic-warning" : "bg-primary"
            }
          />
          <p className="text-muted-foreground text-xs">
            {tCredit("creditsUsedOfTotal", {
              used: formatCreditsForDisplay(usage.used),
              total: formatCreditsForDisplay(usage.total),
            })}
          </p>
          {renewalLabel !== null ? (
            <p className="text-muted-foreground text-xs">{renewalLabel}</p>
          ) : null}
        </div>
      ) : null}
      {showExtraCredits ? (
        <>
          <div className="bg-border h-px" />
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">
              {tCredit("extraCredits")}
            </p>
            <p className="text-sm leading-none font-medium tabular-nums">
              {tBilling("balanceCreditsLabel", {
                credits: displayExtraCredits,
              })}
            </p>
            <p className="text-muted-foreground text-xs">
              {tCredit("extraCreditsDescription")}
            </p>
          </div>
        </>
      ) : null}
      <div className="bg-border h-px" />
      <div className="space-y-2">
        {/* `sm` is 32px, under the 44px a finger needs; only desktop gets it. */}
        <Button
          type="button"
          size="sm"
          onClick={handleBuyCredits}
          className="h-11 w-full justify-center gap-1.5 md:h-8"
        >
          <Coins className="size-4 shrink-0" aria-hidden />
          {buyCreditsLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-muted-foreground hover:text-foreground h-11 w-full justify-start gap-2 font-normal md:h-8"
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          {tCredit("logout")}
        </Button>
      </div>
    </div>
  );

  const popoverContent = (
    <PopoverContent
      side={isCollapsed ? "right" : "top"}
      align={isCollapsed ? "end" : "start"}
      container={portalContainer}
      // Radix only shifts an oversized panel, it never scrolls it, so a full
      // summary (usage bar, renewal, extra credits) would spill off a short
      // viewport. Cap it at what Radix measured as available — never sooner —
      // and scroll the remainder.
      className="bg-popover text-popover-foreground max-h-(--radix-popover-content-available-height) w-64 overflow-y-auto overscroll-contain rounded-xl border p-3 shadow-md"
    >
      {details}
    </PopoverContent>
  );

  if (!isCollapsed) {
    return (
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        {popoverContent}
      </Popover>
    );
  }

  // Collapsed rail: the label the expanded chip shows inline moves into a
  // tooltip, suppressed while the popover itself is open.
  return (
    <div className="flex w-full justify-center">
      <Tooltip open={isOpen ? false : undefined}>
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          </TooltipTrigger>
          {popoverContent}
        </Popover>
        <TooltipContent side="right" align="center">
          {t("collapsedSummary", { name: displayName, summary })}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

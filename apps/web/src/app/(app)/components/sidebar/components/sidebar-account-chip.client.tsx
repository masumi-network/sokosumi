"use client";

import gravatarUrl from "gravatar-url";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactElement } from "react";
import { PresenceDot } from "@/components/chat/presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSelfPresence } from "@/hooks/use-self-presence";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";
import {
  ACCOUNT_SUMMARY_POPOVER_CONTENT_CLASS,
  isLowCreditsBalance,
  resolveAccountCreditsLabel,
  resolveAccountDisplayName,
  resolveAccountSummaryLabel,
} from "./account-summary-labels";
import { AccountSummaryMenu } from "./account-summary-menu.client";
import type {
  AccountAdminSettingsChrome,
  AccountSummaryCreditProps,
  AccountSummaryIdentityProps,
} from "./account-summary-types";
import { useAccountSummaryOpenState } from "./use-account-summary-open-state";

const GRAVATAR_SIZE = 80;

export interface SidebarAccountChipProps
  extends AccountSummaryCreditProps,
    AccountSummaryIdentityProps {
  adminSettingsChrome: AccountAdminSettingsChrome;
}

/**
 * Desktop sidebar account/credits control. Mobile uses the header account
 * control instead (`HeaderAccountControl`), so this returns null on mobile.
 *
 * Open state lives in the desktop-only child so mobile unmount drops it and
 * remount on desktop starts closed (no local-state reset Effect).
 */
export function SidebarAccountChip(
  props: SidebarAccountChipProps,
): ReactElement | null {
  const { isMobile } = useSidebar();
  if (isMobile) {
    return null;
  }

  return <SidebarAccountChipDesktop {...props} />;
}

function SidebarAccountChipDesktop({
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
  adminSettingsChrome,
}: SidebarAccountChipProps): ReactElement {
  const t = useTranslations("App.Sidebar.Account");
  const tBilling = useTranslations("App.Billing");
  const tPresence = useTranslations("App.Channels.Presence");
  const { state } = useSidebar();
  const presence = useSelfPresence();
  const { isOpen, menuInstance, handleOpenChange, closeMenu } =
    useAccountSummaryOpenState();

  const isCollapsed = state === "collapsed";
  const displayName = resolveAccountDisplayName(
    sessionUser.name,
    sessionUser.email,
  );
  const presenceLabel = tPresence(presence);
  const creditsLabel = resolveAccountCreditsLabel(totalCredits, (credits) =>
    tBilling("balanceCreditsLabel", { credits }),
  );
  const isLowCredits = isLowCreditsBalance(totalCredits, lowCreditsThreshold);
  const summary = resolveAccountSummaryLabel({
    planName,
    creditsLabel,
    planAndCredits: (plan, credits) => t("planAndCredits", { plan, credits }),
    detailsUnavailable: t("detailsUnavailable"),
  });

  const trigger = (
    <button
      type="button"
      aria-label={t("openSummary", { name: displayName, summary })}
      className={cn(
        "group/chip hover:bg-sidebar-accent focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent flex cursor-pointer items-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-hidden",
        isCollapsed ? "size-8 justify-center" : "w-full gap-2.5 p-2",
      )}
    >
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
        <PresenceDot
          presence={presence}
          label={presenceLabel}
          className="border-sidebar absolute -right-0.5 -bottom-0.5"
        />
      </span>
      {isCollapsed ? null : (
        <>
          <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
            <span className="w-full truncate text-left text-sm leading-tight font-medium">
              {displayName}
            </span>
            <span
              className={cn(
                "flex w-full items-center gap-1 text-xs leading-tight",
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

  const popoverContent = (
    <PopoverContent
      side={isCollapsed ? "right" : "top"}
      align={isCollapsed ? "end" : "start"}
      container={null}
      className={ACCOUNT_SUMMARY_POPOVER_CONTENT_CLASS}
    >
      <AccountSummaryMenu
        key={menuInstance}
        sessionUser={sessionUser}
        planName={planName}
        totalCredits={totalCredits}
        extraCredits={extraCredits}
        creditUsage={creditUsage}
        subscriptionPeriodEndMs={subscriptionPeriodEndMs}
        currentTimestampMs={currentTimestampMs}
        lowCreditsThreshold={lowCreditsThreshold}
        buyCreditsLabel={buyCreditsLabel}
        buyCreditsPath={buyCreditsPath}
        adminSettingsChrome={adminSettingsChrome}
        onRequestClose={closeMenu}
      />
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

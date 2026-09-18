"use client";

import { resolveAccountDisplayName } from "@sokosumi/utils";
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
 * Desktop sidebar account/credits control. Mobile uses the You tab/page
 * for account actions, so this returns null on mobile.
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
      aria-label={t("openSummary", {
        name: displayName,
        presence: presenceLabel,
        summary,
      })}
      className={cn(
        // `pl-1` rather than `p-2`: footer chrome it may be, but its face
        // still sits on the 28px leading axis every row's mark uses, so it
        // shrinks in place when the sidebar collapses instead of sliding 4px.
        "group/chip focus-visible:ring-sidebar-ring hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-2 pl-1 transition-colors focus-visible:ring-2 focus-visible:outline-hidden",
        // Rail language matches `sidebarMenuButtonVariants`: rings on
        // transparent, not a fill. Classes live on the element (not behind
        // JS `isCollapsed`) so the boot-collapsed group and the Suspense
        // swap keep size-6 + rings without a 32px square flash.
        "group-data-[collapsible=icon]:ring-sidebar-ring group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:ml-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:hover:bg-transparent group-data-[collapsible=icon]:hover:ring-1 group-data-[collapsible=icon]:data-[state=open]:bg-transparent group-data-[collapsible=icon]:data-[state=open]:ring-2 group-data-[collapsible=icon]:data-[state=open]:hover:ring-2",
      )}
    >
      <span className="relative shrink-0">
        {/* Square vs the rooms' circles. Size tracks the fallback via the
            collapsible group, so credits streaming in do not 32↔24 the face. */}
        <Avatar className="size-8 rounded-md group-data-[collapsible=icon]:size-6">
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
          {/* Fallback defaults to `rounded-full`; without this its fill stays
              a circle inside the square clip. */}
          <AvatarFallback className="bg-muted text-muted-foreground rounded-md text-[0.6875rem] font-medium">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        {/* `size-2` on the rail, where the face is 24px and sits in a column
            of DM faces that are also 24px carrying a `size-2` mark. Expanded
            the face is 32px, which is what the default 10px mark is drawn for. */}
        <PresenceDot
          presence={presence}
          ground="sidebar"
          className="absolute -right-0.5 -bottom-0.5 group-data-[collapsible=icon]:size-2"
          title={presenceLabel}
        />
      </span>
      {isCollapsed ? null : (
        <>
          <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 group-data-[collapsible=icon]:hidden">
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
            className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]/chip:rotate-180 group-data-[collapsible=icon]:hidden"
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
    // No `justify-center`: the chip's own `ml-1` puts its face on the
    // sidebar's 28px leading axis, and centring it here would split the 3px
    // left over and land the face 1.5px right of every row's mark.
    <div className="flex w-full">
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

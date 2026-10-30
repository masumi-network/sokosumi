"use client";

import { resolveAccountDisplayName } from "@sokosumi/utils";
import gravatarUrl from "gravatar-url";
import { AlertTriangle, ChevronsUpDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactElement } from "react";
import { PresenceDot } from "@/components/chat/presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSidebar } from "@/components/ui/sidebar";
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
  const format = useFormatter();
  const presence = useSelfPresence();
  const { isOpen, menuInstance, handleOpenChange, closeMenu } =
    useAccountSummaryOpenState();

  const displayName = resolveAccountDisplayName(
    sessionUser.name,
    sessionUser.email,
  );
  const presenceLabel = tPresence(presence);
  const creditsLabel = resolveAccountCreditsLabel(totalCredits, (credits) =>
    tBilling("balanceCreditsLabel", { credits }),
  );
  // At a glance: "943.5K credits", cut rather than rounded up, so the chip
  // never shows more than the account holds. The exact figure stays in the
  // accessible name.
  const compactCreditsLabel = resolveAccountCreditsLabel(
    totalCredits,
    (credits) =>
      t("compactCredits", {
        count: credits,
        credits: format.number(credits, {
          notation: "compact",
          maximumFractionDigits: 1,
          roundingMode: "trunc",
        }),
      }),
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
        // still sits on the 28px leading axis every row's mark uses.
        "group/chip focus-visible:ring-sidebar-ring press hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-2 pl-1 transition-colors focus-visible:ring-2 focus-visible:outline-hidden",
      )}
    >
      <span className="relative shrink-0">
        {/* Square vs the rooms' circles. */}
        <Avatar className="size-8 rounded-md">
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
          <AvatarFallback className="bg-muted text-muted-foreground rounded-md text-2xs font-medium">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        <PresenceDot
          presence={presence}
          ground="sidebar"
          className="absolute -right-0.5 -bottom-0.5"
          title={presenceLabel}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-left text-sm leading-tight font-medium">
            {displayName}
          </span>
          {planName !== null ? (
            <Badge
              variant="outline"
              className="border-sidebar-border text-muted-foreground rounded-sm px-1 py-0 text-2xs leading-4"
            >
              {planName}
            </Badge>
          ) : null}
        </span>
        <span
          className={cn(
            "flex w-full items-center gap-1 text-xs leading-tight",
            isLowCredits ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {isLowCredits ? (
            <AlertTriangle className="size-3 shrink-0" aria-hidden />
          ) : null}
          <span className="min-w-0 truncate tabular-nums">
            {compactCreditsLabel ?? t("detailsUnavailable")}
          </span>
        </span>
      </span>
      <ChevronsUpDown
        className="text-muted-foreground size-3.5 shrink-0"
        aria-hidden
      />
    </button>
  );

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
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
    </Popover>
  );
}

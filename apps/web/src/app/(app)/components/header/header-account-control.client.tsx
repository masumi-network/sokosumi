"use client";

import gravatarUrl from "gravatar-url";
import { useTranslations } from "next-intl";
import type { ReactElement } from "react";
import {
  ACCOUNT_SUMMARY_POPOVER_CONTENT_CLASS,
  resolveAccountCreditsLabel,
  resolveAccountDisplayName,
  resolveAccountSummaryLabel,
} from "@/app/components/sidebar/components/account-summary-labels";
import { AccountSummaryMenu } from "@/app/components/sidebar/components/account-summary-menu.client";
import type {
  AccountAdminSettingsChrome,
  AccountSummaryCreditProps,
  AccountSummaryIdentityProps,
} from "@/app/components/sidebar/components/account-summary-types";
import { useAccountSummaryOpenState } from "@/app/components/sidebar/components/use-account-summary-open-state";
import { PresenceDot } from "@/components/chat/presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSelfPresence } from "@/hooks/use-self-presence";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

const GRAVATAR_SIZE = 80;

export interface HeaderAccountControlProps
  extends AccountSummaryCreditProps,
    AccountSummaryIdentityProps {
  adminSettingsChrome: AccountAdminSettingsChrome;
  className?: string;
}

export function HeaderAccountControl({
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
  className,
}: HeaderAccountControlProps): ReactElement {
  const t = useTranslations("App.Sidebar.Account");
  const tBilling = useTranslations("App.Billing");
  const tPresence = useTranslations("App.Channels.Presence");
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
  const summary = resolveAccountSummaryLabel({
    planName,
    creditsLabel,
    planAndCredits: (plan, credits) => t("planAndCredits", { plan, credits }),
    detailsUnavailable: t("detailsUnavailable"),
  });

  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center",
        className,
      )}
    >
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("openSummary", { name: displayName, summary })}
            className="hover:bg-accent focus-visible:ring-ring data-[state=open]:bg-accent relative flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
          >
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
              className="border-background absolute -right-0.5 -bottom-0.5"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
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
    </div>
  );
}

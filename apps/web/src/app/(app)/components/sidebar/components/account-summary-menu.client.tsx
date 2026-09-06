"use client";

import { resolveAccountDisplayName, type SessionUser } from "@sokosumi/utils";
import gravatarUrl from "gravatar-url";
import { Coins, LogOut, Settings, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactElement, useRef, useState } from "react";
import { openConsentPreferences } from "@/components/analytics/cookie-banner";
import { PresenceDot } from "@/components/chat/presence-dot";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useSelfPresence } from "@/hooks/use-self-presence";
import { getInitials } from "@/lib/utils/text";

import { AccountPopoverDrill } from "./account-popover-drill.client";
import type {
  AccountAdminSettingsChrome,
  AccountPopoverPanel,
  AccountSummaryCreditProps,
  AccountSummaryIdentityProps,
} from "./account-summary-types";
import { CreditsCycleOverview } from "./credits-cycle-overview.client";

const GRAVATAR_SIZE = 80;
const ADMIN_HREF = "/admin";

export interface AccountSummaryMenuProps
  extends AccountSummaryCreditProps,
    AccountSummaryIdentityProps {
  onRequestClose: () => void;
  adminSettingsChrome: AccountAdminSettingsChrome;
}

export function AccountSummaryMenu({
  sessionUser,
  planName,
  creditUsage,
  subscriptionPeriodEndMs,
  currentTimestampMs,
  buyCreditsLabel,
  buyCreditsPath,
  onRequestClose,
  adminSettingsChrome,
}: AccountSummaryMenuProps): ReactElement {
  const t = useTranslations("App.Sidebar.Account");
  const tCredit = useTranslations("Components.UserAvatar");
  const tPresence = useTranslations("App.Channels.Presence");
  const tMenu = useTranslations("App.Sidebar.Content.MenuItems");
  const { showLogoutModal } = useGlobalModalsContext();
  const router = useRouter();
  const presence = useSelfPresence();
  const menuRootRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<AccountPopoverPanel>({ kind: "root" });

  const displayName = resolveAccountDisplayName(
    sessionUser.name,
    sessionUser.email,
  );
  const presenceLabel = tPresence(presence);

  function handleBuyCredits() {
    onRequestClose();
    router.push(buyCreditsPath);
  }

  function handleLogout() {
    onRequestClose();
    showLogoutModal({ id: sessionUser.id, email: sessionUser.email });
  }

  function handleAdmin() {
    onRequestClose();
    router.push(ADMIN_HREF);
  }

  function handleNavigateRoute(href: string) {
    onRequestClose();
    router.push(href);
  }

  function handleOpenExternal(url: string) {
    onRequestClose();
    if (url.startsWith("mailto:")) {
      window.location.href = url;
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleOpenConsent() {
    onRequestClose();
    openConsentPreferences();
  }

  // PopoverContent stays mounted across root ↔ drill swaps; short viewports
  // often leave scrollTop mid-summary, hiding the incoming panel header.
  function handleNavigatePanel(next: AccountPopoverPanel) {
    setPanel(next);
    const scrollContainer = menuRootRef.current?.closest(
      "[data-slot='popover-content']",
    );
    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.scrollTop = 0;
    }
  }

  return (
    <div ref={menuRootRef}>
      {panel.kind !== "root" ? (
        <AccountPopoverDrill
          key={panel.kind}
          panel={panel}
          members={adminSettingsChrome.members}
          activeOrganizationId={adminSettingsChrome.activeOrganizationId}
          showDeveloperVendors={adminSettingsChrome.showDeveloperVendors}
          onNavigatePanel={handleNavigatePanel}
          onNavigateRoute={handleNavigateRoute}
          onOpenExternal={handleOpenExternal}
          onOpenConsent={handleOpenConsent}
        />
      ) : (
        <div className="space-y-3 text-left">
          <div className="flex items-center gap-2.5">
            <AccountSummaryAvatar
              sessionUser={sessionUser}
              displayName={displayName}
            />
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
          <CreditsCycleOverview
            creditUsage={creditUsage}
            subscriptionPeriodEndMs={subscriptionPeriodEndMs}
            currentTimestampMs={currentTimestampMs}
          />
          {creditUsage !== null ? <div className="bg-border h-px" /> : null}
          <div className="space-y-2">
            <Button
              type="button"
              size="sm"
              onClick={handleBuyCredits}
              className="h-11 w-full justify-center gap-1.5 md:h-8"
            >
              <Coins className="size-4 shrink-0" aria-hidden />
              {buyCreditsLabel}
            </Button>
            <div className="divide-border divide-y">
              {adminSettingsChrome.adminMenuEnabled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleAdmin}
                  className="text-muted-foreground hover:text-foreground h-10 w-full justify-start gap-2 rounded-none font-normal"
                >
                  <ShieldCheck className="size-4 shrink-0" aria-hidden />
                  {tMenu("admin")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleNavigatePanel({ kind: "settings" })}
                className="text-muted-foreground hover:text-foreground h-10 w-full justify-start gap-2 rounded-none font-normal"
              >
                <Settings className="size-4 shrink-0" aria-hidden />
                {tMenu("settings")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-muted-foreground hover:text-foreground h-10 w-full justify-start gap-2 rounded-none font-normal"
              >
                <LogOut className="size-4 shrink-0" aria-hidden />
                {tCredit("logout")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountSummaryAvatar({
  sessionUser,
  displayName,
}: {
  sessionUser: SessionUser;
  displayName: string;
}) {
  return (
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
  );
}

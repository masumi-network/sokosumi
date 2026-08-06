"use client";

import type { SessionUser } from "@sokosumi/utils";
import gravatarUrl from "gravatar-url";
import { Coins, LogOut, Settings, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactElement, useState } from "react";
import { PresenceDot } from "@/components/chat/presence-dot";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSelfPresence } from "@/hooks/use-self-presence";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { getInitials } from "@/lib/utils/text";

import { AccountPopoverDrill } from "./account-popover-drill.client";
import type {
  AccountPopoverPanel,
  AccountSummaryCreditProps,
  AccountSummaryIdentityProps,
  MobileAdminSettingsChrome,
} from "./account-summary-types";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const GRAVATAR_SIZE = 80;
const ADMIN_HREF = "/admin";

export interface AccountSummaryMenuProps
  extends AccountSummaryCreditProps,
    AccountSummaryIdentityProps {
  onRequestClose: () => void;
  mobileAdminSettings?: MobileAdminSettingsChrome;
}

export function AccountSummaryMenu({
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
  onRequestClose,
  mobileAdminSettings,
}: AccountSummaryMenuProps): ReactElement {
  const t = useTranslations("App.Sidebar.Account");
  const tCredit = useTranslations("Components.UserAvatar");
  const tBilling = useTranslations("App.Billing");
  const tPresence = useTranslations("App.Channels.Presence");
  const tMenu = useTranslations("App.Sidebar.Content.MenuItems");
  const { showLogoutModal } = useGlobalModalsContext();
  const router = useRouter();
  const presence = useSelfPresence();
  const [panel, setPanel] = useState<AccountPopoverPanel>({ kind: "root" });

  const displayName = sessionUser.name.trim() || sessionUser.email;
  const presenceLabel = tPresence(presence);
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

  const displayExtraCredits =
    extraCredits === null ? null : formatCreditsForDisplay(extraCredits);
  const showExtraCredits =
    usage !== null && displayExtraCredits !== null && displayExtraCredits > 0;

  function resolveRenewalLabel(): string | null {
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

  function handleBuyCredits() {
    onRequestClose();
    router.push(buyCreditsPath);
  }

  function handleLogout() {
    onRequestClose();
    showLogoutModal(sessionUser.email);
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

  const renewalLabel = resolveRenewalLabel();

  if (mobileAdminSettings && panel.kind !== "root") {
    return (
      <AccountPopoverDrill
        panel={panel}
        members={mobileAdminSettings.members}
        activeOrganizationId={mobileAdminSettings.activeOrganizationId}
        showDeveloperVendors={mobileAdminSettings.showDeveloperVendors}
        onNavigatePanel={setPanel}
        onNavigateRoute={handleNavigateRoute}
        onOpenExternal={handleOpenExternal}
      />
    );
  }

  return (
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
        <Button
          type="button"
          size="sm"
          onClick={handleBuyCredits}
          className="h-11 w-full justify-center gap-1.5 md:h-8"
        >
          <Coins className="size-4 shrink-0" aria-hidden />
          {buyCreditsLabel}
        </Button>
        {mobileAdminSettings ? (
          <div className="divide-border divide-y">
            {mobileAdminSettings.adminMenuEnabled ? (
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
              onClick={() => setPanel({ kind: "settings" })}
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
        ) : (
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
        )}
      </div>
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

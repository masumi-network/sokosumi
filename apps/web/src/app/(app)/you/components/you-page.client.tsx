"use client";

import type { SessionUser } from "@sokosumi/utils";
import gravatarUrl from "gravatar-url";
import {
  Calendar,
  ChevronRight,
  Coins,
  HardDrive,
  LogOut,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactElement } from "react";
import HeaderWorkspaceSwitch from "@/app/components/header/header-workspace-switch.client";
import {
  isLowCreditsBalance,
  resolveAccountCreditsLabel,
  resolveAccountDisplayName,
} from "@/app/components/sidebar/components/account-summary-labels";
import type {
  AccountAdminSettingsChrome,
  AccountSummaryCreditProps,
} from "@/app/components/sidebar/components/account-summary-types";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { PresenceDot } from "@/components/chat/presence-dot";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSelfPresence } from "@/hooks/use-self-presence";
import { useSession } from "@/lib/auth/auth.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { getInitials } from "@/lib/utils/text";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const GRAVATAR_SIZE = 160;
const ADMIN_HREF = "/admin";
const SETTINGS_HREF = "/account";
const DRIVE_HREF = "/drive";
const CALENDAR_HREF = "/calendar";

export interface YouPageClientProps extends AccountSummaryCreditProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  hasPersonalWorkspace: boolean;
  activeOrganizationId: string | null;
  calendarMenuEnabled: boolean;
  adminSettingsChrome: AccountAdminSettingsChrome;
}

export function YouPageClient({
  sessionUser,
  members,
  hasPersonalWorkspace,
  activeOrganizationId: serverActiveOrganizationId,
  calendarMenuEnabled,
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
}: YouPageClientProps): ReactElement {
  const t = useTranslations("App.Sidebar.Account");
  const tCredit = useTranslations("Components.UserAvatar");
  const tBilling = useTranslations("App.Billing");
  const tPresence = useTranslations("App.Channels.Presence");
  const tMenu = useTranslations("App.Sidebar.Content.MenuItems");
  const { showLogoutModal } = useGlobalModalsContext();
  const router = useRouter();
  const presence = useSelfPresence();
  const { data: clientSession } = useSession();
  const { isPending, handleSelectWorkspace } = useWorkspaceSwitcher();

  const clientActiveOrganizationId =
    clientSession?.session.activeOrganizationId;
  const hasClientActiveOrganization = clientActiveOrganizationId !== undefined;

  const liveActiveOrganizationId = hasClientActiveOrganization
    ? clientActiveOrganizationId
    : serverActiveOrganizationId;

  const activeOrganizationId = isPending
    ? serverActiveOrganizationId
    : liveActiveOrganizationId;

  const displayName = resolveAccountDisplayName(
    sessionUser.name,
    sessionUser.email,
  );
  const presenceLabel = tPresence(presence);
  const usage = creditUsage;
  const creditsLabel = resolveAccountCreditsLabel(totalCredits, (credits) =>
    tBilling("balanceCreditsLabel", { credits }),
  );
  const isLowCredits = isLowCreditsBalance(totalCredits, lowCreditsThreshold);

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

  const renewalLabel = resolveRenewalLabel();

  function handleLogout() {
    showLogoutModal({ id: sessionUser.id, email: sessionUser.email });
  }

  return (
    <div
      className="mx-auto w-full max-w-lg px-4 py-6 md:py-8"
      data-testid="you-page"
    >
      <div
        className={cn(
          "space-y-6",
          isPending && "pointer-events-none animate-pulse opacity-60",
        )}
      >
        <header className="space-y-4">
          <YouMenuGroup>
            <HeaderWorkspaceSwitch
              sessionUser={sessionUser}
              members={members}
              hasPersonalWorkspace={hasPersonalWorkspace}
              activeOrganizationId={activeOrganizationId}
              isPending={isPending}
              onSelectWorkspace={handleSelectWorkspace}
              layout="row"
            />
          </YouMenuGroup>
          <div className="flex items-start gap-4">
            <YouPageAvatar
              sessionUser={sessionUser}
              displayName={displayName}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <h1 className="truncate text-xl leading-tight font-semibold">
                {displayName}
              </h1>
              <p className="text-muted-foreground truncate text-sm">
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
        </header>

        <section className="space-y-4" aria-labelledby="you-credits-heading">
          <div className="space-y-1">
            <p
              id="you-credits-heading"
              className="text-lg leading-none font-semibold tracking-tight tabular-nums"
            >
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
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={() => router.push(buyCreditsPath)}
            className="h-11 w-full justify-center gap-1.5 md:h-8"
            data-testid="you-buy-credits"
          >
            <Coins className="size-4 shrink-0" aria-hidden />
            {buyCreditsLabel}
          </Button>
        </section>

        <nav aria-label={tMenu("settings")} className="space-y-6">
          <YouMenuGroup>
            {calendarMenuEnabled ? (
              <YouMenuLink
                href={CALENDAR_HREF}
                icon={<Calendar className="size-4 shrink-0" aria-hidden />}
                label={tMenu("calendar")}
                testId="you-schedules"
              />
            ) : null}
            <YouMenuLink
              href={DRIVE_HREF}
              icon={<HardDrive className="size-4 shrink-0" aria-hidden />}
              label={tMenu("drive")}
              testId="you-files"
            />
          </YouMenuGroup>

          <YouMenuGroup>
            {adminSettingsChrome.adminMenuEnabled ? (
              <YouMenuLink
                href={ADMIN_HREF}
                icon={<ShieldCheck className="size-4 shrink-0" aria-hidden />}
                label={tMenu("admin")}
                testId="you-admin"
              />
            ) : null}
            <YouMenuLink
              href={SETTINGS_HREF}
              icon={<Settings className="size-4 shrink-0" aria-hidden />}
              label={tMenu("settings")}
              testId="you-settings"
            />
          </YouMenuGroup>
        </nav>

        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={handleLogout}
          className="h-11 w-full gap-2 md:h-8"
          data-testid="you-logout"
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          {tCredit("logout")}
        </Button>
      </div>
    </div>
  );
}

function YouPageAvatar({
  sessionUser,
  displayName,
}: {
  sessionUser: SessionUser;
  displayName: string;
}) {
  return (
    <Avatar className="size-16 shrink-0">
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
      <AvatarFallback className="bg-muted text-muted-foreground text-lg font-medium">
        {getInitials(displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

function YouMenuGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border bg-card-background divide-border divide-y overflow-hidden rounded-lg border">
      {children}
    </div>
  );
}

function YouMenuLink({
  href,
  icon,
  label,
  testId,
}: {
  href: string;
  icon: ReactElement;
  label: string;
  testId: string;
}) {
  return (
    <Button
      asChild
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground h-11 w-full justify-between gap-2 rounded-none font-normal md:h-10"
    >
      <Link href={href} data-testid={testId}>
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden />
      </Link>
    </Button>
  );
}

"use client";

import { resolveAccountDisplayName, type SessionUser } from "@sokosumi/utils";
import {
  Calendar,
  Code2,
  Coins,
  HardDrive,
  LifeBuoy,
  LogOut,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactElement } from "react";
import {
  MobileStackedMenuGroup,
  MobileStackedMenuLink,
} from "@/app/components/mobile-stacked-menu/mobile-stacked-menu";
import { getAccountNavItems } from "@/app/components/sidebar/components/account-menu-config";
import {
  isLowCreditsBalance,
  resolveAccountCreditsLabel,
} from "@/app/components/sidebar/components/account-summary-labels";
import type {
  AccountAdminSettingsChrome,
  AccountSummaryCreditProps,
} from "@/app/components/sidebar/components/account-summary-types";
import {
  YOU_DEVELOPER_PATH,
  YOU_HELP_PATH,
  YOU_LEGAL_PATH,
} from "@/app/you/you-submenu-paths";
import { PresenceDot } from "@/components/chat/presence-dot";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSelfPresence } from "@/hooks/use-self-presence";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { getInitials } from "@/lib/utils/text";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const ADMIN_HREF = "/admin";
const DRIVE_HREF = "/drive";
const CALENDAR_HREF = "/calendar";

export interface YouPageClientProps extends AccountSummaryCreditProps {
  sessionUser: SessionUser;
  calendarMenuEnabled: boolean;
  adminSettingsChrome: AccountAdminSettingsChrome;
}

export function YouPageClient({
  sessionUser,
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
  const tYou = useTranslations("App.You.Metadata");
  const { showLogoutModal } = useGlobalModalsContext();
  const router = useRouter();
  const presence = useSelfPresence();

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

  const accountNavItems = getAccountNavItems({
    activeOrganizationId: adminSettingsChrome.activeOrganizationId,
    members: adminSettingsChrome.members,
  });

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

  function getAccountItemLabel(translationKey: string): string {
    return tCredit(
      translationKey as
        | "account"
        | "billing"
        | "connections"
        | "notifications"
        | "organization",
    );
  }

  return (
    <div
      className="mx-auto w-full py-6 md:max-w-4xl md:py-8"
      data-testid="you-page"
    >
      <div className="space-y-6">
        <header className="flex items-start gap-4">
          <YouPageAvatar sessionUser={sessionUser} displayName={displayName} />
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="truncate text-xl leading-tight font-semibold">
              {displayName}
            </h1>
            <p className="text-muted-foreground truncate text-sm">
              {sessionUser.email}
            </p>
            <div
              className="flex items-center gap-2"
              data-testid="you-status-plan"
            >
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

        <nav aria-label={tYou("title")} className="space-y-6">
          <MobileStackedMenuGroup>
            {calendarMenuEnabled ? (
              <MobileStackedMenuLink
                href={CALENDAR_HREF}
                icon={<Calendar className="size-4 shrink-0" aria-hidden />}
                label={tMenu("calendar")}
                testId="you-schedules"
              />
            ) : null}
            <MobileStackedMenuLink
              href={DRIVE_HREF}
              icon={<HardDrive className="size-4 shrink-0" aria-hidden />}
              label={tMenu("drive")}
              testId="you-files"
            />
          </MobileStackedMenuGroup>

          {adminSettingsChrome.adminMenuEnabled ? (
            <MobileStackedMenuGroup>
              <MobileStackedMenuLink
                href={ADMIN_HREF}
                icon={<ShieldCheck className="size-4 shrink-0" aria-hidden />}
                label={tMenu("admin")}
                testId="you-admin"
              />
            </MobileStackedMenuGroup>
          ) : null}

          <MobileStackedMenuGroup>
            {accountNavItems.map(({ key, href, translationKey, Icon }) => (
              <MobileStackedMenuLink
                key={key}
                href={href}
                icon={<Icon className="size-4 shrink-0" aria-hidden />}
                label={getAccountItemLabel(translationKey)}
                testId={`you-${key}`}
              />
            ))}
          </MobileStackedMenuGroup>

          <MobileStackedMenuGroup>
            <MobileStackedMenuLink
              href={YOU_DEVELOPER_PATH}
              icon={<Code2 className="size-4 shrink-0" aria-hidden />}
              label={tCredit("developer")}
              testId="you-developer"
            />
            <MobileStackedMenuLink
              href={YOU_HELP_PATH}
              icon={<LifeBuoy className="size-4 shrink-0" aria-hidden />}
              label={tCredit("help")}
              testId="you-help"
            />
            <MobileStackedMenuLink
              href={YOU_LEGAL_PATH}
              icon={<Scale className="size-4 shrink-0" aria-hidden />}
              label={tCredit("legal")}
              testId="you-legal"
            />
          </MobileStackedMenuGroup>
        </nav>

        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={handleLogout}
          className="text-muted-foreground hover:text-foreground h-11 w-full justify-center gap-2 px-0 font-normal no-underline hover:no-underline md:h-8"
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
      {sessionUser.image ? (
        <AvatarImage src={sessionUser.image} alt="" />
      ) : null}
      <AvatarFallback className="bg-muted text-muted-foreground text-lg font-medium">
        {getInitials(displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

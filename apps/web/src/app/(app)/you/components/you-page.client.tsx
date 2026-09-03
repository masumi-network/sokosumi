"use client";

import { resolveAccountDisplayName, type SessionUser } from "@sokosumi/utils";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Code2,
  Coins,
  Cookie,
  HardDrive,
  LifeBuoy,
  LogOut,
  Scale,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactElement, useState } from "react";
import {
  getAccountNavItems,
  HELP_LINKS,
  type HelpLinkItem,
  LEGAL_LINKS,
  type LegalLinkItem,
} from "@/app/components/sidebar/components/account-menu-config";
import {
  isLowCreditsBalance,
  resolveAccountCreditsLabel,
} from "@/app/components/sidebar/components/account-summary-labels";
import type {
  AccountAdminSettingsChrome,
  AccountSummaryCreditProps,
} from "@/app/components/sidebar/components/account-summary-types";
import { getDeveloperNavItems } from "@/app/components/sidebar/components/developer-menu-config";
import { openConsentPreferences } from "@/components/analytics/cookie-banner";
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

type YouNavPanel =
  | { kind: "root" }
  | { kind: "developer" }
  | { kind: "help" }
  | { kind: "legal" };

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
  const tDeveloper = useTranslations("App.Developer.tabs");
  const tConsent = useTranslations("CookieConsent");
  const { showLogoutModal } = useGlobalModalsContext();
  const router = useRouter();
  const presence = useSelfPresence();
  const [panel, setPanel] = useState<YouNavPanel>({ kind: "root" });
  const [slideFrom, setSlideFrom] = useState<"right" | "left" | null>(null);

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

  function handleNavigatePanel(next: YouNavPanel) {
    setSlideFrom(next.kind === "root" ? "left" : "right");
    setPanel(next);
  }

  function handleOpenExternal(url: string) {
    if (url.startsWith("mailto:")) {
      window.location.href = url;
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function getAccountItemLabel(translationKey: string): string {
    return tCredit(
      translationKey as "account" | "billing" | "connections" | "organization",
    );
  }

  const drillTitle =
    panel.kind === "developer"
      ? tCredit("developer")
      : panel.kind === "help"
        ? tCredit("help")
        : panel.kind === "legal"
          ? tCredit("legal")
          : null;

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

          {adminSettingsChrome.adminMenuEnabled ? (
            <YouMenuGroup>
              <YouMenuLink
                href={ADMIN_HREF}
                icon={<ShieldCheck className="size-4 shrink-0" aria-hidden />}
                label={tMenu("admin")}
                testId="you-admin"
              />
            </YouMenuGroup>
          ) : null}

          <YouMenuGroup>
            {accountNavItems.map(({ key, href, translationKey, Icon }) => (
              <YouMenuLink
                key={key}
                href={href}
                icon={<Icon className="size-4 shrink-0" aria-hidden />}
                label={getAccountItemLabel(translationKey)}
                testId={`you-${key}`}
              />
            ))}
          </YouMenuGroup>

          <div
            key={panel.kind}
            data-testid="you-drill-section"
            className={cn(
              slideFrom !== null && "animate-in fade-in duration-200",
              slideFrom === "right" && "slide-in-from-right-4",
              slideFrom === "left" && "slide-in-from-left-4",
            )}
          >
            <YouMenuGroup>
              {panel.kind === "root" ? (
                <>
                  <YouMenuAction
                    icon={<Code2 className="size-4 shrink-0" aria-hidden />}
                    label={tCredit("developer")}
                    testId="you-developer"
                    onClick={() => handleNavigatePanel({ kind: "developer" })}
                  />
                  <YouMenuAction
                    icon={<LifeBuoy className="size-4 shrink-0" aria-hidden />}
                    label={tCredit("help")}
                    testId="you-help"
                    onClick={() => handleNavigatePanel({ kind: "help" })}
                  />
                  <YouMenuAction
                    icon={<Scale className="size-4 shrink-0" aria-hidden />}
                    label={tCredit("legal")}
                    testId="you-legal"
                    onClick={() => handleNavigatePanel({ kind: "legal" })}
                  />
                </>
              ) : (
                <>
                  <YouMenuBack
                    title={drillTitle ?? tMenu("back")}
                    backLabel={tMenu("back")}
                    testId="you-drill-back"
                    onClick={() => handleNavigatePanel({ kind: "root" })}
                  />
                  {panel.kind === "developer"
                    ? getDeveloperNavItems({
                        showVendors: adminSettingsChrome.showDeveloperVendors,
                      }).map(({ key, href, translationKey, Icon }) => (
                        <YouMenuLink
                          key={key}
                          href={href}
                          icon={
                            <Icon className="size-4 shrink-0" aria-hidden />
                          }
                          label={tDeveloper(translationKey)}
                          testId={`you-developer-${key}`}
                        />
                      ))
                    : null}
                  {panel.kind === "help"
                    ? HELP_LINKS.map((item) => {
                        const Icon = item.icon;
                        return (
                          <YouMenuAction
                            key={item.translationKey}
                            icon={
                              Icon ? (
                                <Icon className="size-4 shrink-0" aria-hidden />
                              ) : (
                                <span className="size-4 shrink-0" aria-hidden />
                              )
                            }
                            label={tCredit(
                              item.translationKey as HelpLinkItem["translationKey"],
                            )}
                            testId={`you-help-${item.translationKey}`}
                            onClick={() => handleOpenExternal(item.url)}
                            chevron={false}
                          />
                        );
                      })
                    : null}
                  {panel.kind === "legal" ? (
                    <>
                      {LEGAL_LINKS.map((item) => {
                        const Icon = item.icon;
                        return (
                          <YouMenuAction
                            key={item.translationKey}
                            icon={
                              Icon ? (
                                <Icon className="size-4 shrink-0" aria-hidden />
                              ) : (
                                <span className="size-4 shrink-0" aria-hidden />
                              )
                            }
                            label={tCredit(
                              item.translationKey as LegalLinkItem["translationKey"],
                            )}
                            testId={`you-legal-${item.translationKey}`}
                            onClick={() => handleOpenExternal(item.url)}
                            chevron={false}
                          />
                        );
                      })}
                      <YouMenuAction
                        icon={
                          <Cookie className="size-4 shrink-0" aria-hidden />
                        }
                        label={tConsent("settings")}
                        testId="you-cookie-consent"
                        onClick={openConsentPreferences}
                        chevron={false}
                      />
                    </>
                  ) : null}
                </>
              )}
            </YouMenuGroup>
          </div>
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

function YouMenuAction({
  icon,
  label,
  testId,
  onClick,
  chevron = true,
}: {
  icon: ReactElement;
  label: string;
  testId: string;
  onClick: () => void;
  chevron?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground h-11 w-full justify-between gap-2 rounded-none font-normal md:h-10"
      data-testid={testId}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {chevron ? (
        <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden />
      ) : null}
    </Button>
  );
}

function YouMenuBack({
  title,
  backLabel,
  testId,
  onClick,
}: {
  title: string;
  backLabel: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground h-11 w-full justify-start gap-2 rounded-none font-normal md:h-10"
      data-testid={testId}
      aria-label={backLabel}
    >
      <ChevronLeft className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{title}</span>
    </Button>
  );
}

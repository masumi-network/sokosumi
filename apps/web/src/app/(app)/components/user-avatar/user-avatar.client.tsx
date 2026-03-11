"use client";

import { MemberRole, MemberWithOrganization } from "@sokosumi/database";
import {
  BookOpen,
  Building2,
  Cable,
  ChevronDown,
  CircleHelp,
  LifeBuoy,
  LogOut,
  ReceiptText,
  Settings as SettingsIcon,
  User as UserIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SessionUser } from "@/lib/auth/auth";
import { CreditUsage } from "@/lib/types/credit";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

interface UserAvatarClientProps {
  creditUsage?: CreditUsage | null;
  currentTimestampMs: number;
  creditsLabel?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  showAvatar?: boolean;
  showCreditUsage?: boolean;
  showCreditUsageOnMobileOnly?: boolean;
  subscriptionPeriodEndMs?: number | null;
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
}

export default function UserAvatarClient({
  creditUsage,
  currentTimestampMs,
  creditsLabel,
  secondaryLabel,
  showAvatar = true,
  showCreditUsage = true,
  showCreditUsageOnMobileOnly = false,
  subscriptionPeriodEndMs,
  sessionUser,
  members,
  activeOrganizationId,
}: UserAvatarClientProps) {
  const t = useTranslations("Components.UserAvatar");
  const activeOrganizationMember = activeOrganizationId
    ? members.find((member) => member.organizationId === activeOrganizationId)
    : null;
  const canViewBilling =
    !activeOrganizationId ||
    activeOrganizationMember?.role === MemberRole.OWNER ||
    activeOrganizationMember?.role === MemberRole.ADMIN;
  const activeCreditUsage = creditUsage?.hasUsageData ? creditUsage : null;
  const hasCreditUsage = Boolean(activeCreditUsage);
  const creditUsageAriaLabel = t("creditsConsumedProgressAria");
  const creditUsageLabel = activeCreditUsage
    ? t("creditsUsedOfTotal", {
        used: formatCreditsForDisplay(activeCreditUsage.used),
        total: formatCreditsForDisplay(activeCreditUsage.total),
      })
    : null;
  let creditsExpiryLabel: string | null = null;
  if (subscriptionPeriodEndMs) {
    const millisecondsPerDay = 1000 * 60 * 60 * 24;
    const millisecondsUntilExpiry =
      subscriptionPeriodEndMs - currentTimestampMs;

    if (millisecondsUntilExpiry < 0) {
      creditsExpiryLabel = t("creditsExpired");
    } else if (millisecondsUntilExpiry < millisecondsPerDay) {
      creditsExpiryLabel = t("creditsExpiresToday");
    } else {
      const daysUntilExpiry = Math.ceil(
        millisecondsUntilExpiry / millisecondsPerDay,
      );
      creditsExpiryLabel = t("creditsExpiresInDays", { days: daysUntilExpiry });
    }
  }

  const { showLogoutModal } = useGlobalModalsContext();
  const handleOpenExternalLink = (url: string) => {
    if (url.startsWith("mailto:")) {
      window.location.href = url;
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const router = useRouter();
  const { isMobile, state: sidebarState, toggleSidebar } = useSidebar();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isSidebarCollapsed = !isMobile && sidebarState === "collapsed";
  const isMenuVisible = sidebarState !== "collapsed" && isMenuOpen;
  const shouldShowCreditUsage =
    showCreditUsage && (!showCreditUsageOnMobileOnly || isMobile);

  const closeMenu = () => {
    setIsMenuOpen(false);
  };

  const handleMenuOpenChange = (open: boolean) => {
    if (open && sidebarState === "collapsed") {
      return;
    }
    setIsMenuOpen(open);
  };

  useEffect(() => {
    if (sidebarState === "collapsed") {
      const timer = setTimeout(() => {
        setIsMenuOpen(false);
      }, 200);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => setIsMenuOpen(false), 0);
    return () => clearTimeout(timer);
  }, [sidebarState]);

  const handleClick = (e: React.MouseEvent, path: string) => {
    e.preventDefault();

    if (!path) {
      return;
    }

    closeMenu();
    router.push(path);
    // Close sidebar if on mobile
    if (isMobile) {
      toggleSidebar();
    }
  };

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {shouldShowCreditUsage && hasCreditUsage ? (
        creditsLabel ? (
          <TooltipProvider>
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <div className="w-full min-w-28 space-y-1 pr-0 md:w-auto md:pr-4">
                  {creditsExpiryLabel ? (
                    <div className="text-muted-foreground w-fit text-xs font-semibold">
                      {creditsExpiryLabel}
                    </div>
                  ) : null}
                  <Progress
                    className="h-1.5"
                    value={activeCreditUsage?.percentageUsed ?? 0}
                    aria-label={creditUsageAriaLabel}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="gap-2">
                  <p className="pb-1 font-semibold">{t("subscriptionUsage")}</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {creditUsageLabel ? <li>{creditUsageLabel}</li> : null}
                    {creditUsageLabel ? <li>{creditsExpiryLabel}</li> : null}
                  </ul>
                  {creditsLabel ? (
                    <>
                      <p className="pt-2 pb-1 font-semibold">
                        {t("extraCredits")}
                      </p>
                      <ul className="list-disc space-y-1 pl-4">
                        <li>{creditsLabel}</li>
                        <li>{t("extraCreditsDescription")}</li>
                      </ul>
                    </>
                  ) : null}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <div className="min-w-28 space-y-1 md:pr-4">
            {creditsExpiryLabel ? (
              <div className="text-muted-foreground w-fit text-[11px]">
                {creditsExpiryLabel}
              </div>
            ) : null}
            <Progress
              className="h-1.5"
              value={activeCreditUsage?.percentageUsed ?? 0}
              aria-label={creditUsageAriaLabel}
            />
            {creditUsageLabel ? (
              <div className="text-muted-foreground w-fit text-[11px]">
                {creditUsageLabel}
              </div>
            ) : null}
          </div>
        )
      ) : null}
      {showAvatar ? (
        <DropdownMenu open={isMenuVisible} onOpenChange={handleMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className={cn(
                "min-h-[56px] cursor-pointer items-center md:p-2",
                isSidebarCollapsed ? "justify-center" : "",
              )}
              aria-label={t("settings")}
              tooltip={sessionUser.email}
            >
              <div className="text-primary flex w-full items-center gap-2">
                <span className="flex shrink-0 group-data-[collapsible=icon]:-ml-0.5 group-data-[collapsible=icon]:size-8">
                  <SettingsIcon className="text-muted-foreground size-5" />
                </span>
                {!isSidebarCollapsed ? (
                  <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                    <span className="text-sm leading-none font-semibold">
                      {t("settings")}
                    </span>
                    {secondaryLabel ? (
                      <span className="text-muted-foreground truncate text-xs leading-none">
                        {secondaryLabel}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {!isSidebarCollapsed ? (
                  <ChevronDown className="text-muted-foreground size-4 shrink-0" />
                ) : null}
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent className="w-64" align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground truncate rounded-t-sm py-2">
                {sessionUser.email}
              </DropdownMenuLabel>
              {/* <DropdownMenuSeparator /> */}
              <DropdownMenuItem
                className="flex cursor-pointer items-center gap-2"
                onClick={(e: React.MouseEvent) => handleClick(e, "/account")}
              >
                <UserIcon className="text-muted-foreground" />
                {t("account")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex cursor-pointer items-center gap-2"
                onClick={(e: React.MouseEvent) =>
                  handleClick(e, "/organizations")
                }
              >
                <Building2 className="text-muted-foreground" />
                {t("organizations")}
              </DropdownMenuItem>
              {canViewBilling ? (
                <DropdownMenuItem
                  className="flex cursor-pointer items-center gap-2"
                  onClick={(e: React.MouseEvent) => handleClick(e, "/billing")}
                >
                  <ReceiptText className="text-muted-foreground" />
                  {t("billing")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="flex cursor-pointer items-center gap-2"
                onClick={(e: React.MouseEvent) =>
                  handleClick(e, "/connections")
                }
              >
                <Cable className="text-muted-foreground" />
                {t("connections")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="flex cursor-pointer items-center gap-2">
                <LifeBuoy className="text-muted-foreground size-4" />
                {t("help")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    closeMenu();
                    handleOpenExternalLink(
                      "https://docs.sokosumi.com/documentation",
                    );
                  }}
                >
                  <BookOpen className="text-muted-foreground size-4" />
                  {t("documentation")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    closeMenu();
                    handleOpenExternalLink("mailto:info@sokosumi.com");
                  }}
                >
                  <CircleHelp className="text-muted-foreground size-4" />
                  {t("support")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  {t("legal")}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    closeMenu();
                    handleOpenExternalLink(
                      "https://www.sokosumi.com/terms-of-service",
                    );
                  }}
                >
                  {t("termsOfService")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    closeMenu();
                    handleOpenExternalLink(
                      "https://www.sokosumi.com/privacy-policy",
                    );
                  }}
                >
                  {t("privacyPolicy")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    closeMenu();
                    handleOpenExternalLink("https://www.sokosumi.com/imprint");
                  }}
                >
                  {t("imprint")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    closeMenu();
                    handleOpenExternalLink(
                      "https://www.sokosumi.com/acceptable-use",
                    );
                  }}
                >
                  {t("acceptableUse")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2"
              onClick={() => {
                closeMenu();
                showLogoutModal(sessionUser.email);
              }}
            >
              <LogOut className="text-muted-foreground" />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

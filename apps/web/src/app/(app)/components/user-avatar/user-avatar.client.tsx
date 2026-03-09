"use client";

import { MemberRole, MemberWithOrganization } from "@sokosumi/database";
import gravatarUrl from "gravatar-url";
import {
  BookOpen,
  Building2,
  Cable,
  ChevronDown,
  CircleHelp,
  LifeBuoy,
  LogOut,
  ReceiptText,
  User as UserIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { Button } from "@/components/ui/button";
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
import { useSidebar } from "@/components/ui/sidebar";
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

import UserAvatarContent from "./user-avatar-content";

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
  primaryLabel,
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
  const shouldShowCreditUsage =
    showCreditUsage && (!showCreditUsageOnMobileOnly || isMobile);

  const handleClick = (e: React.MouseEvent, path: string) => {
    e.preventDefault();

    if (!path) {
      return;
    }

    setIsMenuOpen(false);
    router.push(path);
    // Close sidebar if on mobile
    if (isMobile) {
      toggleSidebar();
    }
  };

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {!isSidebarCollapsed && shouldShowCreditUsage && hasCreditUsage ? (
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
                  <p className="pb-1 font-semibold">{t("creditsSummary")}</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {creditUsageLabel ? <li>{creditUsageLabel}</li> : null}
                    <li>{creditsLabel}</li>
                  </ul>
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
        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <TooltipProvider disableHoverableContent>
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className={cn(
                      "min-h-11 px-1 py-1 hover:bg-transparent focus-visible:bg-transparent",
                      isSidebarCollapsed
                        ? "size-11 min-w-0 justify-center px-0"
                        : "w-full min-w-40 justify-between",
                    )}
                    aria-label={`User profile for ${sessionUser.name ?? "current user"}`}
                  >
                    <div className="flex w-full items-center justify-between gap-2 md:justify-center">
                      <div className="flex shrink-0">
                        <UserAvatarContent
                          imageUrl={
                            sessionUser.image ??
                            gravatarUrl(sessionUser.email, {
                              size: 80,
                              default: "404",
                            })
                          }
                          imageAlt={sessionUser.name ?? "User avatar"}
                        />
                      </div>
                      {!isSidebarCollapsed &&
                      (primaryLabel || secondaryLabel) ? (
                        <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                          {primaryLabel ? (
                            <span className="text-sm leading-none font-semibold">
                              {primaryLabel}
                            </span>
                          ) : null}
                          {secondaryLabel ? (
                            <span className="text-muted-foreground text-xs leading-none">
                              {secondaryLabel}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {!isSidebarCollapsed ? (
                        <ChevronDown className="text-muted-foreground size-4" />
                      ) : null}
                    </div>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">{sessionUser.email}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

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
                    setIsMenuOpen(false);
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
                    setIsMenuOpen(false);
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
                    setIsMenuOpen(false);
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
                    setIsMenuOpen(false);
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
                    setIsMenuOpen(false);
                    handleOpenExternalLink("https://www.sokosumi.com/imprint");
                  }}
                >
                  {t("imprint")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    setIsMenuOpen(false);
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
                setIsMenuOpen(false);
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

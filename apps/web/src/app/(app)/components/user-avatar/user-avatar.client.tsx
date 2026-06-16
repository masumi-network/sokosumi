"use client";

import type { SessionUser } from "@sokosumi/utils";
import { MemberRole, type MemberWithOrganization } from "@sokosumi/utils";
import {
  BookOpen,
  Bot,
  Building2,
  Cable,
  ChevronDown,
  CircleHelp,
  Landmark,
  LifeBuoy,
  ListChecks,
  LogOut,
  ReceiptText,
  Scale,
  ScrollText,
  Settings as SettingsIcon,
  Shield,
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
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface UserAvatarClientProps {
  secondaryLabel?: string;
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
}

export default function UserAvatarClient({
  secondaryLabel,
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
            {activeOrganizationMember ? (
              <DropdownMenuItem
                className="flex cursor-pointer items-center gap-2"
                onClick={(e: React.MouseEvent) =>
                  handleClick(
                    e,
                    `/organizations/${activeOrganizationMember.organization.slug}`,
                  )
                }
              >
                <Building2 className="text-muted-foreground" />
                {t("organizations")}
              </DropdownMenuItem>
            ) : null}
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
              onClick={(e: React.MouseEvent) => handleClick(e, "/connections")}
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
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="flex cursor-pointer items-center gap-2">
              <Scale className="text-muted-foreground size-4" />
              {t("legal")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => {
                  closeMenu();
                  handleOpenExternalLink(
                    "https://www.house-of-communication.com/de/en/brands/plan-net/landingpages/agentic-services/legal-ai-coworkers.html",
                  );
                }}
              >
                <Bot className="text-muted-foreground size-4" />
                {t("serviceplanAiCoworker")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => {
                  closeMenu();
                  handleOpenExternalLink(
                    "https://www.sokosumi.com/terms-of-service",
                  );
                }}
              >
                <ScrollText className="text-muted-foreground size-4" />
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
                <Shield className="text-muted-foreground size-4" />
                {t("privacyPolicy")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => {
                  closeMenu();
                  handleOpenExternalLink("https://www.sokosumi.com/imprint");
                }}
              >
                <Landmark className="text-muted-foreground size-4" />
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
                <ListChecks className="text-muted-foreground size-4" />
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
    </div>
  );
}

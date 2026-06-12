"use client";

import { MemberRole, type MemberWithOrganization } from "@sokosumi/database";
import {
  BookOpen,
  Bot,
  Building2,
  Cable,
  CircleHelp,
  Landmark,
  LifeBuoy,
  ListChecks,
  LogOut,
  ReceiptText,
  Scale,
  ScrollText,
  Shield,
  User as UserIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, useState } from "react";

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
import type { SessionUser } from "@/lib/auth/auth";

import HeaderWorkspaceAvatar from "./header-workspace-avatar";

interface HeaderUserMenuProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  secondaryLabel?: string;
}

interface HelpLinkItem {
  url: string;
  translationKey: "documentation" | "support";
  icon?: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
}

interface LegalLinkItem {
  url: string;
  translationKey:
    | "termsOfService"
    | "privacyPolicy"
    | "imprint"
    | "acceptableUse"
    | "serviceplanAiCoworker";
  icon?: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
}

const HELP_LINKS: HelpLinkItem[] = [
  {
    url: "https://docs.sokosumi.com/documentation",
    translationKey: "documentation",
    icon: BookOpen,
  },
  {
    url: "mailto:info@sokosumi.com",
    translationKey: "support",
    icon: CircleHelp,
  },
];

const LEGAL_LINKS: LegalLinkItem[] = [
  {
    url: "https://www.house-of-communication.com/de/en/brands/plan-net/landingpages/agentic-services/legal-ai-coworkers.html",
    translationKey: "serviceplanAiCoworker",
    icon: Bot,
  },
  {
    url: "https://www.sokosumi.com/terms-of-service",
    translationKey: "termsOfService",
    icon: ScrollText,
  },
  {
    url: "https://www.sokosumi.com/privacy-policy",
    translationKey: "privacyPolicy",
    icon: Shield,
  },
  {
    url: "https://www.sokosumi.com/imprint",
    translationKey: "imprint",
    icon: Landmark,
  },
  {
    url: "https://www.sokosumi.com/acceptable-use",
    translationKey: "acceptableUse",
    icon: ListChecks,
  },
];

function HelpLinks({
  handleOpenExternalLink,
  tUserAvatar,
}: {
  handleOpenExternalLink: (url: string) => void;
  tUserAvatar: (key: HelpLinkItem["translationKey"]) => string;
}) {
  return (
    <>
      {HELP_LINKS.map((item) => {
        const Icon = item.icon;
        return (
          <DropdownMenuItem
            key={item.translationKey}
            className="cursor-pointer"
            onClick={() => handleOpenExternalLink(item.url)}
          >
            {Icon ? (
              <Icon className="text-muted-foreground size-4" aria-hidden />
            ) : null}
            <span>{tUserAvatar(item.translationKey)}</span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

function LegalLinks({
  handleOpenExternalLink,
  tUserAvatar,
}: {
  handleOpenExternalLink: (url: string) => void;
  tUserAvatar: (key: LegalLinkItem["translationKey"]) => string;
}) {
  return (
    <>
      {LEGAL_LINKS.map((item) => {
        const Icon = item.icon;
        return (
          <DropdownMenuItem
            key={item.translationKey}
            className="cursor-pointer"
            onClick={() => handleOpenExternalLink(item.url)}
          >
            {Icon ? (
              <Icon className="text-muted-foreground size-4" aria-hidden />
            ) : null}
            <span>{tUserAvatar(item.translationKey)}</span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

export default function HeaderUserMenu({
  sessionUser,
  members,
  activeOrganizationId,
  secondaryLabel,
}: HeaderUserMenuProps) {
  const tUserAvatar = useTranslations("Components.UserAvatar");
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const { showLogoutModal } = useGlobalModalsContext();
  const activeOrganizationMember = activeOrganizationId
    ? members.find((member) => member.organizationId === activeOrganizationId)
    : null;
  const canViewBilling =
    !activeOrganizationId ||
    activeOrganizationMember?.role === MemberRole.OWNER ||
    activeOrganizationMember?.role === MemberRole.ADMIN;
  const activeOrganizationPath = activeOrganizationMember
    ? `/organizations/${activeOrganizationMember.organization.slug}`
    : null;
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const router = useRouter();

  const closeMenu = () => {
    setIsDropdownOpen(false);
  };

  const handleRouteNavigation = (path: string) => {
    router.push(path);
    closeMenu();
  };

  const handleOpenExternalLink = (url: string) => {
    closeMenu();
    if (url.startsWith("mailto:")) {
      window.location.href = url;
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:opacity-80 flex shrink-0 items-center transition-opacity"
          aria-label={tUserAvatar("settings")}
        >
          <HeaderWorkspaceAvatar
            sessionUser={sessionUser}
            organization={activeOrganizationMember?.organization ?? null}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="end">
        <DropdownMenuLabel className="truncate">
          <span className="block truncate text-sm font-medium">
            {sessionUser.email}
          </span>
          {secondaryLabel ? (
            <span className="text-muted-foreground mt-0.5 block truncate text-xs font-normal">
              {secondaryLabel}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => handleRouteNavigation("/account")}
          >
            <UserIcon className="text-muted-foreground size-4" />
            <span>{tUserAvatar("account")}</span>
          </DropdownMenuItem>
          {activeOrganizationPath ? (
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => handleRouteNavigation(activeOrganizationPath)}
            >
              <Building2 className="text-muted-foreground size-4" />
              <span>{tOrganizationSwitcher("organizationsHeading")}</span>
            </DropdownMenuItem>
          ) : null}
          {canViewBilling ? (
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => handleRouteNavigation("/billing")}
            >
              <ReceiptText className="text-muted-foreground size-4" />
              <span>{tUserAvatar("billing")}</span>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => handleRouteNavigation("/connections")}
          >
            <Cable className="text-muted-foreground size-4" />
            <span>{tUserAvatar("connections")}</span>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <LifeBuoy className="text-muted-foreground size-4" />
              <span>{tUserAvatar("help")}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <HelpLinks
                handleOpenExternalLink={handleOpenExternalLink}
                tUserAvatar={tUserAvatar}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <Scale className="text-muted-foreground size-4" />
              <span>{tUserAvatar("legal")}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <LegalLinks
                handleOpenExternalLink={handleOpenExternalLink}
                tUserAvatar={tUserAvatar}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => {
            closeMenu();
            showLogoutModal(sessionUser.email);
          }}
        >
          <LogOut className="text-muted-foreground size-4" />
          <span>{tUserAvatar("logout")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

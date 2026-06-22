"use client";

import type { SessionUser } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type {
  MemberWithOrganization,
  OrganizationRecord,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import {
  HELP_LINKS,
  type HelpLinkItem,
  LEGAL_LINKS,
  type LegalLinkItem,
} from "./account-menu-config";
import {
  SettingsPanelHeader,
  SettingsSubmenuContent,
} from "./settings-submenu-content";
import { SidebarSubmenu, type SidebarSubmenuPanel } from "./sidebar-submenu";

interface SidebarNavProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  planLabel: string;
  activeOrganization: OrganizationRecord | null;
  children: ReactNode;
}

function getSubmenuResetKey(
  state: "expanded" | "collapsed",
  isMobile: boolean,
  openMobile: boolean,
): string {
  if (state === "collapsed") {
    return "collapsed";
  }

  if (isMobile && !openMobile) {
    return "mobile-closed";
  }

  return "active";
}

function ExternalLinkPanelContent({
  items,
  getLabel,
}: {
  items: HelpLinkItem[] | LegalLinkItem[];
  getLabel: (translationKey: string) => string;
}) {
  function handleOpenExternalLink(url: string) {
    if (url.startsWith("mailto:")) {
      window.location.href = url;
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {items.map((item) => {
            const Icon = item.icon;

            return (
              <SidebarMenuItem key={item.translationKey}>
                <SidebarMenuButton
                  type="button"
                  onClick={() => handleOpenExternalLink(item.url)}
                  className={cn(
                    "flex min-h-auto w-full items-center gap-2 px-3",
                    "text-tertiary-foreground dark:text-muted-foreground",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  {Icon ? <Icon className="size-4" aria-hidden /> : null}
                  <span className="flex-1 truncate text-left">
                    {getLabel(item.translationKey)}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function SidebarNavInner({
  sessionUser,
  members,
  activeOrganizationId,
  planLabel,
  activeOrganization,
  children,
}: SidebarNavProps) {
  const tMenu = useTranslations("App.Sidebar.Content.MenuItems");
  const tUserAvatar = useTranslations("Components.UserAvatar");
  const [activeId, setActiveId] = useState<string | null>(null);

  const panels = useMemo<SidebarSubmenuPanel[]>(
    () => [
      {
        id: "settings",
        parentId: null,
        header: (
          <SettingsPanelHeader
            planLabel={planLabel}
            sessionUser={sessionUser}
            activeOrganization={activeOrganization}
          />
        ),
        content: (
          <SettingsSubmenuContent
            sessionUser={sessionUser}
            members={members}
            activeOrganizationId={activeOrganizationId}
          />
        ),
      },
      {
        id: "help",
        parentId: "settings",
        header: (
          <span className="truncate text-sm font-medium">
            {tUserAvatar("help")}
          </span>
        ),
        content: (
          <ExternalLinkPanelContent
            items={HELP_LINKS}
            getLabel={(key) =>
              tUserAvatar(key as HelpLinkItem["translationKey"])
            }
          />
        ),
      },
      {
        id: "legal",
        parentId: "settings",
        header: (
          <span className="truncate text-sm font-medium">
            {tUserAvatar("legal")}
          </span>
        ),
        content: (
          <ExternalLinkPanelContent
            items={LEGAL_LINKS}
            getLabel={(key) =>
              tUserAvatar(key as LegalLinkItem["translationKey"])
            }
          />
        ),
      },
    ],
    [
      activeOrganization,
      activeOrganizationId,
      members,
      planLabel,
      sessionUser,
      tUserAvatar,
    ],
  );

  return (
    <SidebarSubmenu
      activeId={activeId}
      onActiveIdChange={setActiveId}
      panels={panels}
      backLabel={tMenu("back")}
    >
      {children}
    </SidebarSubmenu>
  );
}

export default function SidebarNav({
  sessionUser,
  members,
  activeOrganizationId,
  planLabel,
  activeOrganization,
  children,
}: SidebarNavProps) {
  const { state, isMobile, openMobile } = useSidebar();
  const resetKey = getSubmenuResetKey(state, isMobile, openMobile);

  return (
    <SidebarNavInner
      key={resetKey}
      sessionUser={sessionUser}
      members={members}
      activeOrganizationId={activeOrganizationId}
      planLabel={planLabel}
      activeOrganization={activeOrganization}
    >
      {children}
    </SidebarNavInner>
  );
}

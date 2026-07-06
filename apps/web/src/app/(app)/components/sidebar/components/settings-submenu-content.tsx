"use client";

import type { SessionUser } from "@sokosumi/utils";
import { ChevronRight, LifeBuoy, LogOut, Scale } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import { getAccountNavItems } from "./account-menu-config";
import { useSidebarSubmenu } from "./sidebar-submenu";

interface SettingsSubmenuContentProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
}

export function SettingsSubmenuContent({
  sessionUser,
  members,
  activeOrganizationId,
}: SettingsSubmenuContentProps) {
  const tUserAvatar = useTranslations("Components.UserAvatar");
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const { goBack, openSubmenu } = useSidebarSubmenu();
  const { showLogoutModal } = useGlobalModalsContext();

  const accountNavItems = getAccountNavItems({
    activeOrganizationId,
    members,
  });

  function closeMobileSheet() {
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  function handleNavigate(path: string) {
    closeMobileSheet();
    router.push(path);
  }

  function handleLogout() {
    goBack();
    closeMobileSheet();
    showLogoutModal(sessionUser.email);
  }

  function getItemLabel(translationKey: string): string {
    if (translationKey === "organizationsHeading") {
      return tOrganizationSwitcher("organizationsHeading");
    }

    return tUserAvatar(
      translationKey as
        | "account"
        | "billing"
        | "connections"
        | "organizationsHeading",
    );
  }

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {accountNavItems.map(({ key, href, translationKey, Icon }) => (
            <SidebarMenuItem key={key}>
              <SidebarMenuButton
                type="button"
                onClick={() => handleNavigate(href)}
                className={cn(
                  "flex min-h-auto w-full items-center gap-2 px-3",
                  "text-tertiary-foreground dark:text-muted-foreground",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span className="flex-1 truncate text-left">
                  {getItemLabel(translationKey)}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              onClick={() => openSubmenu("help")}
              className={cn(
                "flex min-h-auto w-full items-center gap-2 px-3",
                "text-tertiary-foreground dark:text-muted-foreground",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <LifeBuoy className="size-4" aria-hidden />
              <span className="flex-1 truncate text-left">
                {tUserAvatar("help")}
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              onClick={() => openSubmenu("legal")}
              className={cn(
                "flex min-h-auto w-full items-center gap-2 px-3",
                "text-tertiary-foreground dark:text-muted-foreground",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Scale className="size-4" aria-hidden />
              <span className="flex-1 truncate text-left">
                {tUserAvatar("legal")}
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              onClick={handleLogout}
              className={cn(
                "flex min-h-auto w-full items-center gap-2 px-3",
                "text-tertiary-foreground dark:text-muted-foreground",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <LogOut className="size-4" aria-hidden />
              <span className="flex-1 truncate text-left">
                {tUserAvatar("logout")}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

interface SettingsPanelHeaderProps {
  planLabel: string;
}

export function SettingsPanelHeader({ planLabel }: SettingsPanelHeaderProps) {
  return (
    <span
      className="block min-w-0 w-full truncate text-sm font-medium"
      title={planLabel}
    >
      {planLabel}
    </span>
  );
}

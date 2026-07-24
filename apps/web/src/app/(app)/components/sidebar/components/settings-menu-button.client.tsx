"use client";

import { Settings } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import {
  SIDEBAR_SUBMENU_SLIDE_DURATION_MS,
  useSidebarSubmenu,
} from "./sidebar-submenu";

function isSettingsRouteActive(pathname: string): boolean {
  return (
    pathname === "/account" ||
    pathname === "/billing" ||
    pathname === "/connections" ||
    pathname === "/developer" ||
    pathname.startsWith("/developer/") ||
    pathname.startsWith("/organizations/")
  );
}

export default function SettingsMenuButton() {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const { state, setOpen } = useSidebar();
  const { openSubmenu } = useSidebarSubmenu();
  const label = t("settings");
  const isActive = isSettingsRouteActive(pathname);

  function handleClick() {
    if (state === "collapsed") {
      setOpen(true);
      window.setTimeout(() => {
        openSubmenu("settings");
      }, SIDEBAR_SUBMENU_SLIDE_DURATION_MS);
      return;
    }

    openSubmenu("settings");
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        isActive={isActive}
        tooltip={label}
        onClick={handleClick}
        className={cn(
          "flex min-h-auto w-full items-center gap-2 px-3",
          isActive
            ? "text-primary-foreground"
            : "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <Settings className="size-4" aria-hidden />
        <span className="flex-1 truncate">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { getDeveloperNavItems } from "./developer-menu-config";

interface DeveloperSubmenuContentProps {
  showVendors: boolean;
}

export function DeveloperSubmenuContent({
  showVendors,
}: DeveloperSubmenuContentProps) {
  const t = useTranslations("App.Developer.tabs");
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const items = getDeveloperNavItems({ showVendors });

  function handleNavigate(path: string) {
    if (isMobile) {
      setOpenMobile(false);
    }
    router.push(path);
  }

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {items.map(({ key, href, translationKey, Icon }) => (
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
                  {t(translationKey)}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

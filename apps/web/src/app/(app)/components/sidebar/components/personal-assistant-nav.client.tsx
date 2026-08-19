"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

/**
 * Personal Assistant (Soko Bot) entry at the top of the sidebar, set apart
 * from the rest of the nav by a divider rendered in the sidebar composition.
 * Available to every signed-in user.
 */
export default function PersonalAssistantNav() {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const isActive =
    pathname === SOKO_BOT_ROUTE || pathname.startsWith(`${SOKO_BOT_ROUTE}/`);

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive} size="lg">
              <SheetClose asChild>
                <Link
                  href={SOKO_BOT_ROUTE}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-auto w-full items-center gap-2.5 rounded-lg border px-3",
                    "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:px-0",
                    isActive
                      ? "border-transparent text-primary-foreground"
                      : "border-primary/50 hover:border-primary/70 text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Bot className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1 truncate font-medium group-data-[collapsible=icon]:hidden">
                    {t("sokoBot")}
                  </span>
                </Link>
              </SheetClose>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

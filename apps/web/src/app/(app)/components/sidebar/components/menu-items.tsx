"use client";

import { CalendarClock, ListTodo, Rss, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ComponentType, SVGProps } from "react";

import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface MenuItemConfig {
  key: string;
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  hasIndicator?: boolean;
}

export default function MenuItems() {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();

  const isPathActive = (href: string) => {
    if (pathname === href) {
      return true;
    }

    return pathname.startsWith(`${href}/`);
  };

  const items: MenuItemConfig[] = [
    {
      key: "task-manager",
      href: "/tasks",
      label: t("taskManager"),
      Icon: ListTodo,
    },
    {
      key: "my-feed",
      href: "/feed",
      label: t("myFeed"),
      Icon: Rss,
    },
    {
      key: "explore-agents",
      href: "/agents",
      label: t("exploreAgents"),
      Icon: Sparkles,
    },
    {
      key: "scheduled-agents",
      href: "/schedules",
      label: t("scheduledAgents"),
      Icon: CalendarClock,
    },
  ];

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {items.map(({ key, href, label, Icon, hasIndicator }) => {
            const isActive = isPathActive(href);

            return (
              <SidebarMenuItem key={key}>
                <SidebarMenuButton asChild isActive={isActive} className="">
                  <SheetClose asChild>
                    <Link
                      href={href}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex min-h-auto w-full items-center gap-2 px-3",
                        isActive
                          ? "text-primary-foreground"
                          : "text-tertiary-foreground dark:text-muted-foreground hover:text-primary-foreground dark:hover:text-primary-foreground",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      <span className="flex-1 truncate">{label}</span>
                      {hasIndicator ? (
                        <span
                          aria-hidden
                          className="bg-primary-iris size-2 shrink-0 rounded-full"
                        />
                      ) : null}
                    </Link>
                  </SheetClose>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

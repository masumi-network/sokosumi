"use client";

import { Search } from "lucide-react";
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

  const items: MenuItemConfig[] = [
    {
      key: "explore-agents",
      href: "/agents",
      label: t("exploreAgents"),
      Icon: Search,
    },
  ];

  return (
    <SidebarGroup className="w-72 md:w-64">
      <SidebarGroupContent className="mt-2">
        <SidebarMenu>
          {items.map(({ key, href, label, Icon, hasIndicator }) => {
            const isActive = pathname === href;

            return (
              <SidebarMenuItem key={key}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  className="px-4 py-5"
                >
                  <SheetClose asChild>
                    <Link
                      href={href}
                      aria-current={isActive ? "page" : undefined}
                      className="flex w-full items-center gap-2"
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

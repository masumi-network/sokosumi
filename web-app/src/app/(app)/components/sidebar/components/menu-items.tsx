import { Search } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
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

export default async function MenuItems() {
  const t = await getTranslations("App.Sidebar.Content.MenuItems");

  const items = await getMenuItems(t);

  return (
    <SidebarGroup className="w-72 md:w-64">
      <SidebarGroupContent className="mt-2">
        <SidebarMenu>
          {items.map(({ key, href, label, Icon, hasIndicator }) => (
            <SidebarMenuItem key={key}>
              <SidebarMenuButton asChild className="px-4 py-5">
                <SheetClose asChild>
                  <Link href={href} className="flex w-full items-center gap-2">
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
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

type SidebarTranslator = Awaited<ReturnType<typeof getTranslations>>;

async function getMenuItems(t: SidebarTranslator): Promise<MenuItemConfig[]> {
  const items: MenuItemConfig[] = [
    {
      key: "explore-agents",
      href: "/agents",
      label: t("exploreAgents"),
      Icon: Search,
    },
  ];

  return items;
}

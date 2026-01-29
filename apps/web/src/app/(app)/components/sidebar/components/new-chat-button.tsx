"use client";

import { Plus } from "lucide-react";
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

export default function NewChatButton() {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const isActive = pathname === "/chat";

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive}
              className="px-4 py-5"
            >
              <SheetClose asChild>
                <Link
                  href="/chat"
                  aria-current={isActive ? "page" : undefined}
                  className="text-primary flex w-full items-center gap-2"
                >
                  <Plus className="size-4" aria-hidden />
                  <span className="flex-1 truncate">{t("newChat")}</span>
                </Link>
              </SheetClose>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

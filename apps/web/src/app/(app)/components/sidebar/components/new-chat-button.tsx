"use client";

import { MessageSquarePlus } from "lucide-react";
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
import { cn } from "@/lib/utils";

export default function NewChatButton() {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const isActive = pathname === "/chat";

  return (
    <SidebarGroup className="w-full pb-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem className="gap-0">
            <SidebarMenuButton asChild isActive={isActive} className="">
              <SheetClose asChild>
                <Link
                  href="/chat"
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-auto w-full items-center gap-2 px-3",
                    isActive
                      ? "text-primary-foreground"
                      : "text-tertiary-foreground dark:text-muted-foreground hover:text-primary-foreground dark:hover:text-primary-foreground",
                  )}
                >
                  <MessageSquarePlus className="size-4" aria-hidden />
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

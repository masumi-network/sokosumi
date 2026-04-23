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
import { cn } from "@/lib/utils";

export default function NewChatTaskActions() {
  const tChat = useTranslations("App.Chat.Chat");
  const pathname = usePathname();
  const isChatActive = pathname === "/chat" || pathname.startsWith("/chat/");

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0 pt-2">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isChatActive}>
              <SheetClose asChild>
                <Link
                  href="/chat"
                  aria-current={isChatActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-auto w-full items-center gap-2 px-3",
                    isChatActive
                      ? "text-primary-foreground"
                      : "text-tertiary-foreground dark:text-muted-foreground hover:text-primary-foreground dark:hover:text-primary-foreground",
                  )}
                >
                  <Plus className="size-4" aria-hidden />
                  <span className="flex-1 truncate">{tChat("sidebarNew")}</span>
                </Link>
              </SheetClose>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

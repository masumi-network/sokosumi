"use client";

import { ListPlus, MessageSquarePlus } from "lucide-react";
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
        <SidebarMenu className="gap-0">
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
                  <MessageSquarePlus className="size-4" aria-hidden />
                  <span className="flex-1 truncate">{tChat("newChat")}</span>
                </Link>
              </SheetClose>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            {/* New Task is never shown as the active sidebar item (Tasks nav covers `/tasks/*`). */}
            <SidebarMenuButton asChild>
              <SheetClose asChild>
                <Link
                  href="/tasks/new"
                  className={cn(
                    "flex min-h-auto w-full items-center gap-2 px-3",
                    "text-tertiary-foreground dark:text-muted-foreground hover:text-primary-foreground dark:hover:text-primary-foreground",
                  )}
                >
                  <ListPlus className="size-4" aria-hidden />
                  <span className="flex-1 truncate">{tChat("newTask")}</span>
                </Link>
              </SheetClose>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

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
  const tChat = useTranslations("App.Chat.Chat");
  const pathname = usePathname();
  const isActive = pathname === "/chat" || pathname.startsWith("/chat/");

  return (
    <SidebarGroup className="w-full pb-0">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive}>
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
                  <span className="flex-1 truncate">{tChat("newChat")}</span>
                </Link>
              </SheetClose>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

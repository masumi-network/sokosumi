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
import { useAppChatRail } from "@/contexts/app-chat-rail-context";
import { cn } from "@/lib/utils";

interface NewChatButtonProps {
  isTaskRailEnabled: boolean;
}

export default function NewChatButton({
  isTaskRailEnabled,
}: NewChatButtonProps) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const { openNewChat } = useAppChatRail();
  const isActive = pathname === "/chat";
  const isStandaloneChat = pathname.startsWith("/chat");
  const shouldOpenRail = false;
  //Keep it for now to avoid breaking changes:
  //eslint-disable-next-line @typescript-eslint/no-unused-vars
  const holdOnToRail = isTaskRailEnabled && !isStandaloneChat;

  return (
    <SidebarGroup className="w-full pb-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem className="gap-0">
            <SidebarMenuButton asChild isActive={isActive} className="">
              <SheetClose asChild>
                {!shouldOpenRail ? (
                  <Link
                    href="/chat"
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex min-h-auto w-full items-center gap-2 px-3",
                      isActive
                        ? "text-primary-foreground"
                        : "text-tertiary-foreground dark:text-muted-foreground",
                    )}
                  >
                    <MessageSquarePlus className="size-4" aria-hidden />
                    <span className="flex-1 truncate">{t("newChat")}</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="flex min-h-auto w-full items-center gap-2"
                    onClick={openNewChat}
                  >
                    <MessageSquarePlus
                      className="text-primary size-4"
                      aria-hidden
                    />
                    <span className="flex-1 truncate">{t("newChat")}</span>
                  </button>
                )}
              </SheetClose>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

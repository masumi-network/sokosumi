"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";

export default function NewChatTaskActions() {
  const tChat = useTranslations("App.Chat.Chat");
  const pathname = usePathname();
  const router = useRouter();
  const isChatActive = pathname === "/chat" || pathname.startsWith("/chat/");
  const sidebarNewLabel = tChat("sidebarNew");
  const isApplePlatform = useIsApplePlatform();
  const shortcutLabel = isApplePlatform ? "⌘N" : "Ctrl+N";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }

      if (
        event.key?.toLowerCase() !== "n" ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return;
      }

      event.preventDefault();
      router.push("/chat");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0 pt-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isChatActive}
              tooltip={{
                children: (
                  <span className="flex items-center gap-2">
                    <span>{sidebarNewLabel}</span>
                    <span className="text-muted-foreground text-xs tracking-widest">
                      {shortcutLabel}
                    </span>
                  </span>
                ),
              }}
            >
              <SheetClose asChild>
                <Link
                  href="/chat"
                  aria-current={isChatActive ? "page" : undefined}
                  aria-keyshortcuts="Meta+N Control+N"
                  className={cn(
                    "flex min-h-auto w-full items-center gap-2 px-3",
                    isChatActive
                      ? "text-primary-foreground"
                      : "text-tertiary-foreground dark:text-muted-foreground hover:text-primary-foreground dark:hover:text-primary-foreground",
                  )}
                >
                  <Plus className="size-4" aria-hidden />
                  <span className="flex-1 truncate">{sidebarNewLabel}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "text-muted-foreground ml-auto hidden shrink-0 text-xs tracking-widest opacity-0 transition-opacity group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 group-data-[collapsible=icon]:hidden md:inline",
                      isChatActive && "text-primary-foreground/80",
                    )}
                  >
                    {shortcutLabel}
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

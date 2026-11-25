"use client";

import { MessageCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { useChatTabUnreadPresence } from "@/app/chat/components/use-chat-tab-unread-presence";
import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSidebarPanel } from "./sidebar-context-panel";
import { NAV_GROUPS } from "./sidebar-sections";

export function GlobalRail({ mobile = false }: { mobile?: boolean }) {
  const { isMobile } = useSidebar();
  if (mobile && !isMobile) return null;

  return (
    <Suspense
      fallback={
        mobile ? null : (
          <div className="bg-sidebar border-sidebar-border hidden h-dvh w-(--app-rail-width) shrink-0 border-e md:block" />
        )
      }
    >
      <RailControls mobile={mobile} />
    </Suspense>
  );
}

function RailControls({ mobile }: { mobile: boolean }) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const sidebar = useTranslations("App.Sidebar");
  const nav = useTranslations("App.Channels.MobileNav");
  const { open, setOpen } = useSidebar();
  const { showUnreadDot } = useChatTabUnreadPresence();
  const { section, selectSection } = useSidebarPanel();
  const sections = [
    {
      id: "chats" as const,
      Icon: MessageCircle,
      label: nav("chats"),
    },
    ...NAV_GROUPS.map(({ id, Icon }) => ({
      id,
      Icon,
      label: t(`groups.${id}`),
    })),
  ];

  return (
    <nav
      aria-label={nav("ariaLabel")}
      data-global-rail={mobile ? undefined : ""}
      className={cn(
        "bg-sidebar text-sidebar-foreground border-sidebar-border items-center gap-1",
        mobile
          ? "flex shrink-0 justify-around border-b px-2 py-1 md:hidden"
          : "relative z-20 hidden h-dvh w-(--app-rail-width) shrink-0 flex-col border-e pt-3 md:flex",
      )}
    >
      {sections.map(({ id, Icon, label }) => {
        const isActive = id === section;
        const unread = id === "chats" && showUnreadDot;

        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "relative h-12 min-w-0 flex-col gap-0.5 border border-transparent px-0.5 text-2xs",
                  mobile ? "flex-1" : "w-14",
                  isActive &&
                    "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-border after:bg-current after:absolute after:inset-s-0 after:h-4 after:w-0.5 after:rounded-full",
                )}
                aria-label={unread ? `${label}, ${nav("chatsUnread")}` : label}
                aria-controls="app-sidebar-panel"
                aria-pressed={isActive}
                onClick={() => {
                  selectSection?.(id);
                  if (!mobile && !open) setOpen(true);
                }}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                <span aria-hidden className="max-w-full truncate">
                  {label}
                </span>
                {unread ? (
                  <span
                    aria-hidden
                    className="bg-foreground ring-sidebar absolute end-1 top-1 size-1.5 rounded-full ring-2"
                  />
                ) : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent side={mobile ? "bottom" : "right"}>
              {label}
            </TooltipContent>
          </Tooltip>
        );
      })}
      {mobile ? (
        <SheetClose asChild>
          <Button variant="ghost" size="icon" aria-label={sidebar("hide")}>
            <X aria-hidden />
          </Button>
        </SheetClose>
      ) : null}
    </nav>
  );
}

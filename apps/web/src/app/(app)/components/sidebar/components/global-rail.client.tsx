"use client";

import { MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { useChatTabUnreadPresence } from "@/app/chat/components/use-chat-tab-unread-presence";
import {
  CHAT_CATCH_UP_PATH,
  CHAT_CHATS_LIST_PATH,
} from "@/app/chat/utils/chat-route-base";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { useNavPathname } from "@/components/navigation-progress.client";
import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, sidebarSection } from "./sidebar-sections";

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
      <RailLinks mobile={mobile} />
    </Suspense>
  );
}

function RailLinks({ mobile }: { mobile: boolean }) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const sidebar = useTranslations("App.Sidebar");
  const nav = useTranslations("App.Channels.MobileNav");
  const { hrefFor } = useProjectScope();
  const { open, setOpen, setOpenMobile } = useSidebar();
  const { showUnreadDot } = useChatTabUnreadPresence();
  const section = sidebarSection(useNavPathname());
  const sections = [
    {
      id: "chats",
      // Bare /chat is the phone list and redirects to Welcome on desktop.
      href: mobile ? CHAT_CHATS_LIST_PATH : CHAT_CATCH_UP_PATH,
      Icon: MessageCircle,
      label: nav("chats"),
    },
    ...NAV_GROUPS.map(({ id, href, Icon }) => ({
      id,
      href: hrefFor(href),
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
      {sections.map(({ id, href, Icon, label }) => {
        const isActive = id === section;
        const unread = id === "chats" && showUnreadDot;

        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className={cn(
                  "relative size-11 border border-transparent",
                  isActive &&
                    "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-border after:bg-current after:absolute after:inset-s-0 after:h-4 after:w-0.5 after:rounded-full",
                )}
              >
                <Link
                  href={href}
                  aria-label={
                    unread ? `${label}, ${nav("chatsUnread")}` : label
                  }
                  aria-current={isActive ? "true" : undefined}
                  onNavigate={() => {
                    if (mobile) setOpenMobile(false);
                    else if (!open) setOpen(true);
                  }}
                >
                  <Icon aria-hidden className="size-5" />
                  {unread ? (
                    <span
                      aria-hidden
                      className="bg-foreground ring-sidebar absolute end-1 top-1 size-1.5 rounded-full ring-2"
                    />
                  ) : null}
                </Link>
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

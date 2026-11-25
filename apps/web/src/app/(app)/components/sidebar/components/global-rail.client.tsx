"use client";

import { MessageCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { useChatTabUnreadPresence } from "@/app/chat/components/use-chat-tab-unread-presence";
import { useNavPathname } from "@/components/navigation-progress.client";
import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import { useCloseCompactSidebarOnNavigation } from "@/hooks/effects/use-close-compact-sidebar-on-navigation";
import { useEventListener } from "@/hooks/effects/use-event-listener";
import { cn } from "@/lib/utils";
import { useSidebarPanel } from "./sidebar-context-panel";
import { NAV_GROUPS, sidebarSection } from "./sidebar-sections";

export function GlobalRail({ mobile = false }: { mobile?: boolean }) {
  const { isMobile } = useSidebar();
  if (mobile && !isMobile) return null;

  return (
    <Suspense
      fallback={
        mobile ? null : (
          <div className="bg-sidebar border-sidebar-border hidden mt-16 h-[calc(100dvh-4rem)] w-(--app-rail-width) shrink-0 border-e md:block" />
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
  const { open, openMobile, setOpen, isCompact } = useSidebar();
  const currentSection = sidebarSection(useNavPathname());
  useCloseCompactSidebarOnNavigation(!mobile && isCompact, setOpen);
  useEventListener(
    !mobile && isCompact && open ? "document" : null,
    "keydown",
    (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="menu"][data-state="open"]',
        )
      )
        return;
      const panel = document.getElementById("app-sidebar-panel");
      if (panel?.contains(document.activeElement)) {
        document
          .querySelector<HTMLElement>(
            '[data-global-rail] [aria-pressed="true"]',
          )
          ?.focus();
      }
      setOpen(false);
    },
  );
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
          ? "flex shrink-0 justify-around gap-0.5 border-b px-1 py-1 md:hidden"
          : "relative z-20 max-lg:z-[41] hidden mt-16 h-[calc(100dvh-4rem)] w-(--app-rail-width) shrink-0 flex-col border-e pt-15 md:flex sidebar-hidden:pt-3",
      )}
    >
      {sections
        .filter(({ id }) => !mobile || id !== "chats")
        .map(({ id, Icon, label }) => {
          const isActive = id === section && (mobile ? openMobile : open);
          const isCurrent = id === currentSection;
          const unread = id === "chats" && showUnreadDot;

          return (
            <Button
              key={id}
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "relative h-12 min-w-0 flex-col gap-0.5 px-0.5 text-2xs",
                mobile ? "w-auto min-w-11 flex-auto" : "w-16",
                isCurrent &&
                  "after:bg-current after:absolute after:rounded-full md:after:inset-s-0 md:after:h-4 md:after:w-0.5 max-md:after:bottom-0 max-md:after:h-0.5 max-md:after:w-4",
                isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
              aria-label={unread ? `${label}, ${nav("chatsUnread")}` : label}
              aria-controls="app-sidebar-panel"
              aria-current={isCurrent ? "location" : undefined}
              aria-pressed={isActive}
              onClick={(event) => {
                if (!mobile && isCompact && isActive) {
                  setOpen(false);
                  return;
                }
                selectSection?.(id);
                if (!mobile && !open) setOpen(true);
                if (event.detail === 0) {
                  requestAnimationFrame(() => {
                    document
                      .getElementById("app-sidebar-panel")
                      ?.querySelector<HTMLElement>(
                        ":scope > div:not([hidden]) :is(a[href], button:not(:disabled))",
                      )
                      ?.focus();
                  });
                }
              }}
            >
              <Icon
                aria-hidden
                className={cn(
                  "size-4 shrink-0",
                  id !== "work" && "md:size-3.5",
                )}
              />
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
          );
        })}
      {mobile ? (
        <SheetClose asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label={sidebar("hide")}
          >
            <X aria-hidden />
          </Button>
        </SheetClose>
      ) : null}
    </nav>
  );
}

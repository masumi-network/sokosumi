"use client";

import {
  Feather,
  FolderKanban,
  History,
  ListTodo,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, type SVGProps, useEffect, useState } from "react";
import { HistorySearchDialog } from "@/app/components/history-search-dialog";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { getHermesUnreadCountAction } from "@/lib/actions/hermes";
import { cn } from "@/lib/utils";

interface MenuItemsProps {
  activeOrganizationId: string | null;
  /** Hermes nav + unread polling; driven by `hermesBetaEnabled` in app layout. */
  hermesMenuEnabled: boolean;
}

interface MenuItemConfig {
  key: string;
  href?: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  hasIndicator?: boolean;
  badge?: string;
  unreadCount?: number;
  onClick?: () => void;
  shortcutLabel?: string;
  ariaKeyshortcuts?: string;
}

const HERMES_UNREAD_POLL_INTERVAL_MS = 30_000;

function useHermesUnreadCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      const result = await getHermesUnreadCountAction({});
      if (cancelled || !result.ok) return;
      setCount(result.data);
    };

    void tick();
    const interval = setInterval(
      () => void tick(),
      HERMES_UNREAD_POLL_INTERVAL_MS,
    );
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  return enabled ? count : 0;
}

export default function MenuItems({
  activeOrganizationId,
  hermesMenuEnabled,
}: MenuItemsProps) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const tHermes = useTranslations("App.Hermes");
  const tSearch = useTranslations("App.HistorySearchDialog");
  const tHistory = useTranslations("App.History");
  const hermesBetaTag = tHermes("BetaTag");
  const pathname = usePathname();
  const hermesUnread = useHermesUnreadCount(hermesMenuEnabled);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const isApplePlatform = useIsApplePlatform();
  const searchShortcutLabel = isApplePlatform ? "⌘K" : "Ctrl+K";

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
        event.key?.toLowerCase() !== "k" ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return;
      }

      event.preventDefault();
      setSearchModalOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isPathActive = (href: string) => {
    if (pathname === href) {
      return true;
    }

    return pathname.startsWith(`${href}/`);
  };

  const items: MenuItemConfig[] = [
    {
      key: "search",
      label: t("search"),
      Icon: Search,
      onClick: () => setSearchModalOpen(true),
      shortcutLabel: searchShortcutLabel,
      ariaKeyshortcuts: "Meta+K Control+K",
    },
    {
      key: "task-manager",
      href: "/tasks",
      label: t("taskManager"),
      Icon: ListTodo,
    },
    {
      key: "projects",
      href: "/projects",
      label: t("projects"),
      Icon: FolderKanban,
    },
    {
      key: "explore-agents",
      href: "/agents",
      label: t("exploreAgents"),
      Icon: Sparkles,
    },
    ...(hermesMenuEnabled
      ? ([
          {
            key: "hermes",
            href: "/hermes",
            label: t("hermes"),
            Icon: Feather,
            badge: hermesBetaTag,
            unreadCount: hermesUnread,
          },
        ] satisfies MenuItemConfig[])
      : []),
    {
      key: "history",
      href: "/history",
      label: t("history"),
      Icon: History,
    },
  ];

  return (
    <>
      <SidebarGroup className="w-full">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0">
            {items.map(
              ({
                key,
                href,
                label,
                Icon,
                hasIndicator,
                badge,
                unreadCount,
                onClick,
                shortcutLabel,
                ariaKeyshortcuts,
              }) => {
                const isActive = href ? isPathActive(href) : false;
                const showUnread = (unreadCount ?? 0) > 0;
                const unreadDisplay =
                  (unreadCount ?? 0) > 99 ? "99+" : String(unreadCount ?? 0);

                const content = (
                  <>
                    <Icon className="size-4" aria-hidden />
                    <span className="flex-1 truncate">{label}</span>
                    {badge ? (
                      <span
                        className={cn(
                          "border-border/60 text-tertiary-foreground dark:text-muted-foreground rounded border px-1 py-0 text-[10px] font-medium uppercase tracking-wide leading-4",
                          isActive &&
                            "border-primary-foreground/30 text-primary-foreground",
                        )}
                      >
                        {badge}
                      </span>
                    ) : null}
                    {showUnread ? (
                      <span
                        aria-label={`${unreadDisplay} unread`}
                        className="bg-primary text-primary-foreground inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4 tabular-nums"
                      >
                        {unreadDisplay}
                      </span>
                    ) : hasIndicator ? (
                      <span
                        aria-hidden
                        className="bg-primary-iris size-2 shrink-0 rounded-full"
                      />
                    ) : null}
                  </>
                );

                return (
                  <SidebarMenuItem key={key}>
                    {href ? (
                      <SidebarMenuButton asChild isActive={isActive}>
                        <SheetClose asChild>
                          <Link
                            href={href}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                              "flex min-h-auto w-full items-center gap-2 px-3",
                              isActive
                                ? "text-primary-foreground"
                                : "text-tertiary-foreground dark:text-muted-foreground hover:text-primary-foreground dark:hover:text-primary-foreground",
                            )}
                          >
                            {content}
                          </Link>
                        </SheetClose>
                      </SidebarMenuButton>
                    ) : (
                      <>
                        {key === "search" ? (
                          <SheetClose asChild>
                            <SidebarMenuButton
                              type="button"
                              onClick={onClick}
                              aria-keyshortcuts={ariaKeyshortcuts}
                              tooltip={
                                shortcutLabel
                                  ? {
                                      children: (
                                        <span className="flex items-center gap-2">
                                          <span>{label}</span>
                                          <span className="text-muted-foreground text-xs tracking-widest">
                                            {shortcutLabel}
                                          </span>
                                        </span>
                                      ),
                                    }
                                  : undefined
                              }
                              className={cn(
                                "flex min-h-auto w-full items-center gap-2 px-3",
                                "text-tertiary-foreground dark:text-muted-foreground hover:text-primary-foreground dark:hover:text-primary-foreground",
                              )}
                            >
                              {content}
                              {shortcutLabel ? (
                                <span
                                  aria-hidden
                                  className="text-muted-foreground ml-auto hidden shrink-0 text-xs tracking-widest opacity-0 transition-opacity group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 group-data-[collapsible=icon]:hidden md:inline"
                                >
                                  {shortcutLabel}
                                </span>
                              ) : null}
                            </SidebarMenuButton>
                          </SheetClose>
                        ) : (
                          <SidebarMenuButton
                            type="button"
                            onClick={onClick}
                            aria-keyshortcuts={ariaKeyshortcuts}
                            tooltip={
                              shortcutLabel
                                ? {
                                    children: (
                                      <span className="flex items-center gap-2">
                                        <span>{label}</span>
                                        <span className="text-muted-foreground text-xs tracking-widest">
                                          {shortcutLabel}
                                        </span>
                                      </span>
                                    ),
                                  }
                                : undefined
                            }
                            className={cn(
                              "flex min-h-auto w-full items-center gap-2 px-3",
                              "text-tertiary-foreground dark:text-muted-foreground hover:text-primary-foreground dark:hover:text-primary-foreground",
                            )}
                          >
                            {content}
                            {shortcutLabel ? (
                              <span
                                aria-hidden
                                className="text-muted-foreground ml-auto hidden shrink-0 text-xs tracking-widest opacity-0 transition-opacity group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 group-data-[collapsible=icon]:hidden md:inline"
                              >
                                {shortcutLabel}
                              </span>
                            ) : null}
                          </SidebarMenuButton>
                        )}
                      </>
                    )}
                  </SidebarMenuItem>
                );
              },
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <HistorySearchDialog
        open={searchModalOpen}
        onOpenChange={setSearchModalOpen}
        activeOrganizationId={activeOrganizationId}
        labels={{
          dialogTitle: tSearch("title"),
          dialogDescription: tSearch("description"),
          searchPlaceholder: tSearch("searchPlaceholder"),
          empty: tSearch("empty"),
          loading: tSearch("loading"),
          error: tSearch("error"),
          kind: {
            task: tHistory("Row.kind.task"),
            job: tHistory("Row.kind.job"),
            conversation: tHistory("Row.kind.conversation"),
          },
          conversationStatus: {
            active: tHistory("Row.conversationStatus.active"),
            archived: tHistory("Row.conversationStatus.archived"),
          },
        }}
      />
    </>
  );
}

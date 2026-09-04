"use client";

import {
  Bot,
  CalendarDays,
  FolderKanban,
  HardDrive,
  History,
  ListTodo,
  Plus,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, Fragment, type SVGProps } from "react";
import { useOptionalHistorySearch } from "@/app/components/history-search-dialog-provider";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

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
  separatorAfter?: boolean;
}

interface MenuItemsProps {
  calendarMenuEnabled: boolean;
}

export default function MenuItems({ calendarMenuEnabled }: MenuItemsProps) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  // Soft read: Instant Nav shell may mount before HistorySearchDialogProvider.
  const historySearch = useOptionalHistorySearch();
  const { isMobile, setOpenMobile } = useSidebar();

  function handleSearchClick() {
    historySearch?.openHistorySearch();
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  const isPathActive = (href: string) => {
    if (pathname === href) {
      return true;
    }

    return pathname.startsWith(`${href}/`);
  };

  const items: MenuItemConfig[] = [
    {
      key: "new-task",
      href: "/tasks?create=true",
      label: t("newTask"),
      Icon: Plus,
      separatorAfter: true,
    },
    {
      key: "search",
      label: t("search"),
      Icon: Search,
      onClick: handleSearchClick,
      shortcutLabel: historySearch?.searchShortcutLabel,
      ariaKeyshortcuts: historySearch ? "Meta+K Control+K" : undefined,
    },
    {
      key: "explore-agents",
      href: "/agents",
      label: t("exploreAgents"),
      Icon: Bot,
    },
    {
      key: "projects",
      href: "/projects",
      label: t("projects"),
      Icon: FolderKanban,
    },
    {
      key: "task-manager",
      href: "/tasks",
      label: t("taskManager"),
      Icon: ListTodo,
    },
    ...(calendarMenuEnabled
      ? [
          {
            key: "calendar",
            href: "/calendar",
            label: t("calendar"),
            Icon: CalendarDays,
          },
        ]
      : []),
    // Desktop only: mobile keeps Files on the You page account surface.
    ...(!isMobile
      ? [
          {
            key: "drive",
            href: "/drive",
            label: t("drive"),
            Icon: HardDrive,
          },
        ]
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
      <SidebarGroup className="w-full p-0">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0 py-2">
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
                separatorAfter,
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
                          "border-border/60 text-tertiary-foreground dark:text-muted-foreground rounded border px-1 py-0 text-[0.625rem] font-medium uppercase tracking-wide leading-4",
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
                        className="bg-primary text-primary-foreground inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[0.625rem] font-semibold leading-4 tabular-nums"
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
                  <Fragment key={key}>
                    <SidebarMenuItem className="px-2">
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
                                  : "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                              )}
                            >
                              {content}
                            </Link>
                          </SheetClose>
                        </SidebarMenuButton>
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
                            "text-tertiary-foreground dark:text-muted-foreground",
                            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
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
                    </SidebarMenuItem>
                    {separatorAfter ? (
                      <SidebarMenuItem
                        aria-hidden
                        className="py-2 group-data-[collapsible=icon]:hidden"
                      >
                        <div className="bg-sidebar-border h-px w-full" />
                      </SidebarMenuItem>
                    ) : null}
                  </Fragment>
                );
              },
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

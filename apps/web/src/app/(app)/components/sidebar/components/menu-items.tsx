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
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRailSelectionBar,
  SidebarRowSlot,
  useSidebar,
} from "@/components/ui/sidebar";
import { SIDEBAR_ROW_LABEL_CLASS } from "@/components/ui/sidebar-classes";
import { useHasAssignedOrganizationSeat } from "@/contexts/organization-seat-context";
import { cn } from "@/lib/utils";

import { ProjectsMenuItem } from "./projects-menu-item";

interface MenuItemConfig {
  key: string;
  href?: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
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
  const newTaskWizard = useOptionalNewTaskWizard();
  const hasAssignedSeat = useHasAssignedOrganizationSeat();
  const { isMobile, setOpenMobile } = useSidebar();

  function handleSearchClick() {
    historySearch?.openHistorySearch();
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  function handleNewTaskClick() {
    newTaskWizard?.openNewTaskWizard();
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
      // Seated members get the wizard in place. Unseated members keep the
      // Task Manager link, which explains the Seat requirement.
      ...(newTaskWizard && hasAssignedSeat
        ? { onClick: handleNewTaskClick }
        : { href: "/tasks?create=true" }),
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
      {/* `px-2` here rather than on the item, so a nav row's
          `SidebarMenuItem` is the same box a Chat row's is and the rail
          selection bar's `-right-2` lands on the rail's edge in both. The
          separator spans the rail rather than the row, so it takes that
          padding back with `-mx-2`. */}
      <SidebarGroup className="w-full px-2 py-0">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0 py-2">
            {items.map(
              ({
                key,
                href,
                label,
                Icon,
                onClick,
                shortcutLabel,
                ariaKeyshortcuts,
                separatorAfter,
              }) => {
                if (key === "projects") {
                  return <ProjectsMenuItem key={key} />;
                }
                const isActive = href ? isPathActive(href) : false;

                // Collapsed rail hides the label, so every item needs the hint.
                const tooltip = shortcutLabel
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
                  : label;

                const content = (
                  <>
                    <SidebarRowSlot>
                      <Icon className="size-4" aria-hidden />
                    </SidebarRowSlot>
                    <span className={cn(SIDEBAR_ROW_LABEL_CLASS, "truncate")}>
                      {label}
                    </span>
                  </>
                );

                return (
                  <Fragment key={key}>
                    <SidebarMenuItem>
                      {href ? (
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={tooltip}
                        >
                          <SheetClose asChild>
                            <Link
                              href={href}
                              aria-current={isActive ? "page" : undefined}
                              className={cn(
                                isActive
                                  ? "text-sidebar-accent-foreground"
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
                          tooltip={tooltip}
                          className={cn(
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
                      {/* Collapsed, the rail's fill belongs to hover alone, so
                          the open destination is marked on the rail's edge the
                          same way an open Chat room is. */}
                      {isActive ? <SidebarRailSelectionBar /> : null}
                    </SidebarMenuItem>
                    {separatorAfter ? (
                      <SidebarMenuItem aria-hidden className="-mx-2 py-2">
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

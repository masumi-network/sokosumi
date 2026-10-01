"use client";

import { AnnouncedFeature } from "@sokosumi/core-client";
import {
  Bot,
  HardDrive,
  ImagePlus,
  ListTodo,
  Plus,
  Repeat,
  Search,
  Share2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, Fragment, Suspense, type SVGProps } from "react";
import { useOptionalHistorySearch } from "@/app/components/history-search-dialog-provider";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";
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
import {
  SIDEBAR_ROW_FIXED_LABEL_CLASS,
  SIDEBAR_ROW_LABEL_CLASS,
} from "@/components/ui/sidebar-classes";
import { useHasAssignedOrganizationSeat } from "@/contexts/organization-seat-context";
import { cn } from "@/lib/utils";

import {
  SIDEBAR_FEATURE_LABEL_CLASS,
  SidebarFeatureLabel,
} from "./sidebar-feature-label";

interface MenuItemConfig {
  key: string;
  href?: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  onClick?: () => void;
  shortcutLabel?: string;
  ariaKeyshortcuts?: string;
  separatorAfter?: boolean;
  feature?: AnnouncedFeature;
}

/**
 * `socialMenuEnabled` is off by default so the Instant Nav shell, which has
 * not resolved the reader's beta membership yet, leaves the row out rather
 * than guessing it: a row that appears once is cheaper than one that appears
 * and then goes away.
 */
export default function MenuItems({
  socialMenuEnabled = false,
}: {
  socialMenuEnabled?: boolean;
} = {}) {
  return (
    <Suspense fallback={null}>
      <ScopedMenuItems socialMenuEnabled={socialMenuEnabled} />
    </Suspense>
  );
}

function ScopedMenuItems({
  socialMenuEnabled,
}: {
  socialMenuEnabled: boolean;
}) {
  const { hrefFor, projectId } = useProjectScope();
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
    newTaskWizard?.openNewTaskWizard({ projectId });
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
        : {
            href: projectId
              ? `${hrefFor("/tasks")}&create=true`
              : "/tasks?create=true",
          }),
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
      key: "task-manager",
      href: "/tasks",
      label: t("taskManager"),
      Icon: ListTodo,
    },
    {
      key: "schedules",
      href: TASK_SCHEDULES_PATH,
      label: t("schedules"),
      Icon: Repeat,
    },
    // Scoped by `?projectId=` like the rows above it, so `hrefFor` carries the
    // reader's project across without the studio knowing about the switcher.
    {
      key: "studio",
      href: "/studio",
      label: t("contentStudio"),
      Icon: ImagePlus,
      feature: AnnouncedFeature.CONTENT_STUDIO,
    },
    // Social used to be a tab inside a project. It is a destination of its
    // own now, scoped the same way the studio is, and it is still behind the
    // beta so the row only exists where the surface does.
    ...(socialMenuEnabled
      ? [
          {
            key: "social",
            href: "/social",
            label: t("social"),
            Icon: Share2,
            feature: AnnouncedFeature.SOCIAL,
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
            feature: AnnouncedFeature.DRIVE,
          },
        ]
      : []),
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
                feature,
              }) => {
                const isActive = href ? isPathActive(href) : false;
                // The pill wears the rail square's 4px inset and 4px padding
                // at every width, so collapsing only narrows it: its edge
                // and the + inside it stay where they are.
                const newTaskClassName =
                  key === "new-task"
                    ? "ml-1 w-[calc(100%-0.5rem)] pl-1 bg-secondary text-secondary-foreground hover:bg-secondary-hover hover:text-secondary-foreground active:bg-secondary-hover active:text-secondary-foreground data-[state=open]:hover:bg-secondary-hover data-[state=open]:hover:text-secondary-foreground group-data-[collapsible=icon]:hover:bg-secondary-hover group-data-[collapsible=icon]:active:bg-secondary-hover"
                    : undefined;

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
                    <span
                      className={cn(
                        SIDEBAR_ROW_LABEL_CLASS,
                        SIDEBAR_ROW_FIXED_LABEL_CLASS,
                        feature && SIDEBAR_FEATURE_LABEL_CLASS,
                      )}
                    >
                      {feature ? (
                        <SidebarFeatureLabel label={label} feature={feature} />
                      ) : (
                        label
                      )}
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
                          data-sidebar-new-task={
                            key === "new-task" ? "" : undefined
                          }
                          className={newTaskClassName}
                          tooltip={tooltip}
                        >
                          <SheetClose asChild>
                            <Link
                              href={hrefFor(href)}
                              aria-current={isActive ? "page" : undefined}
                              className={cn(
                                key === "new-task"
                                  ? newTaskClassName
                                  : isActive
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
                          data-sidebar-new-task={
                            key === "new-task" ? "" : undefined
                          }
                          aria-keyshortcuts={ariaKeyshortcuts}
                          tooltip={tooltip}
                          className={cn(
                            newTaskClassName ??
                              "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
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

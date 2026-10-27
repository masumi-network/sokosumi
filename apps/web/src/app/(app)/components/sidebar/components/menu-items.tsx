"use client";

import { AnnouncedFeature } from "@sokosumi/core-client";
import {
  Bot,
  HardDrive,
  ImagePlus,
  ListTodo,
  Megaphone,
  Plus,
  Repeat,
  Share2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, Fragment, Suspense, type SVGProps } from "react";
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
  SidebarRowSlot,
  useSidebar,
} from "@/components/ui/sidebar";
import { SIDEBAR_ROW_LABEL_CLASS } from "@/components/ui/sidebar-classes";
import { useHasAssignedOrganizationSeat } from "@/contexts/organization-seat-context";
import { cn } from "@/lib/utils";
import { useMarkFeatureSeen } from "./feature-badges";
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
  separatorAfter?: boolean;
  /** The Badge campaign row this is, when the feature has one. */
  feature?: AnnouncedFeature;
}

/**
 * `socialBetaEnabled` now gates Ads only; Social scheduling is public. It is off by default so
 * the Instant Nav shell, which has not resolved the reader's beta membership
 * yet, leaves the rows out rather than guessing them: a row that appears once
 * is cheaper than one that appears and then goes away.
 */
export default function MenuItems({
  socialBetaEnabled = false,
}: {
  socialBetaEnabled?: boolean;
} = {}) {
  return (
    <Suspense fallback={null}>
      <ScopedMenuItems socialBetaEnabled={socialBetaEnabled} />
    </Suspense>
  );
}

function ScopedMenuItems({
  socialBetaEnabled,
}: {
  socialBetaEnabled: boolean;
}) {
  const { hrefFor, projectId } = useProjectScope();
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const newTaskWizard = useOptionalNewTaskWizard();
  const hasAssignedSeat = useHasAssignedOrganizationSeat();
  const { isMobile, setOpenMobile } = useSidebar();
  const markFeatureSeen = useMarkFeatureSeen();

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
      feature: AnnouncedFeature.NEW_TASK,
    },
    {
      key: "explore-agents",
      href: "/agents",
      label: t("exploreAgents"),
      Icon: Bot,
      feature: AnnouncedFeature.AGENTS,
    },
    {
      key: "task-manager",
      href: "/tasks",
      label: t("taskManager"),
      Icon: ListTodo,
      feature: AnnouncedFeature.TASKS,
    },
    {
      key: "schedules",
      href: TASK_SCHEDULES_PATH,
      label: t("schedules"),
      Icon: Repeat,
      feature: AnnouncedFeature.SCHEDULES,
    },
    // Workspace-wide like Files, so it is not scoped to the reader's project.
    {
      key: "contacts",
      href: "/contacts",
      label: t("contacts"),
      Icon: Users,
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
    // Social scheduling is public and follows the studio's project scope.
    {
      key: "social",
      href: "/social",
      label: t("social"),
      Icon: Share2,
      feature: AnnouncedFeature.SOCIAL,
    },
    ...(socialBetaEnabled
      ? [
          // Ads remains in the utxo beta.
          {
            key: "ads",
            href: "/ads",
            label: t("ads"),
            Icon: Megaphone,
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
          `SidebarMenuItem` is the same box a Chat row's is. The separator
          spans the sidebar rather than the row, so it takes that padding
          back with `-mx-2`. */}
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
                separatorAfter,
                feature,
              }) => {
                const isActive = href ? isPathActive(href) : false;
                // A 4px inset and 4px padding, so the pill's + stays on the
                // same 28px axis as every other row's mark.
                const newTaskClassName =
                  key === "new-task"
                    ? "ml-1 w-[calc(100%-0.5rem)] pl-1 bg-secondary text-secondary-foreground hover:bg-secondary-hover hover:text-secondary-foreground active:bg-secondary-hover active:text-secondary-foreground data-[state=open]:hover:bg-secondary-hover data-[state=open]:hover:text-secondary-foreground"
                    : undefined;

                const content = (
                  <>
                    <SidebarRowSlot>
                      <Icon className="size-4" aria-hidden />
                    </SidebarRowSlot>
                    <span
                      className={cn(
                        SIDEBAR_ROW_LABEL_CLASS,
                        SIDEBAR_FEATURE_LABEL_CLASS,
                      )}
                    >
                      {feature ? (
                        <SidebarFeatureLabel label={label} feature={feature} />
                      ) : (
                        <span className="min-w-0 truncate">{label}</span>
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
                        >
                          <SheetClose asChild>
                            <Link
                              href={hrefFor(href)}
                              onClick={() =>
                                feature && markFeatureSeen(feature)
                              }
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
                          onClick={() => {
                            if (feature) markFeatureSeen(feature);
                            onClick?.();
                          }}
                          data-sidebar-new-task={
                            key === "new-task" ? "" : undefined
                          }
                          className={cn(
                            newTaskClassName ??
                              "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          )}
                        >
                          {content}
                        </SidebarMenuButton>
                      )}
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

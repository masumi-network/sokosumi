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
import {
  type ComponentType,
  Fragment,
  type ReactNode,
  Suspense,
  type SVGProps,
} from "react";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";
import { useSidebarPrototypeVariant } from "@/components/prototype/sidebar-prototype.client";
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
import { useMarkFeatureSeen } from "./feature-badges";
import { NavPrototypeSection } from "./nav-group.prototype.client";
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
  /** PROTOTYPE: the foldable group variants b and c put this row in. */
  group?: "records" | "marketing";
}

/**
 * `socialBetaEnabled` now gates Ads only; Social scheduling is public. It is off by default so
 * the Instant Nav shell, which has not resolved the reader's beta membership
 * yet, leaves the rows out rather than guessing them: a row that appears once
 * is cheaper than one that appears and then goes away.
 */
export default function MenuItems({
  socialBetaEnabled = false,
  prototypeSokoBot = null,
}: {
  socialBetaEnabled?: boolean;
  /** PROTOTYPE: the Soko Bot entry variants b and c show below New task. */
  prototypeSokoBot?: ReactNode;
} = {}) {
  return (
    <Suspense fallback={null}>
      <ScopedMenuItems
        socialBetaEnabled={socialBetaEnabled}
        prototypeSokoBot={prototypeSokoBot}
      />
    </Suspense>
  );
}

function ScopedMenuItems({
  socialBetaEnabled,
  prototypeSokoBot,
}: {
  socialBetaEnabled: boolean;
  prototypeSokoBot: ReactNode;
}) {
  const { hrefFor, projectId } = useProjectScope();
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const newTaskWizard = useOptionalNewTaskWizard();
  const hasAssignedSeat = useHasAssignedOrganizationSeat();
  const { isMobile, setOpenMobile } = useSidebar();
  const markFeatureSeen = useMarkFeatureSeen();
  // PROTOTYPE: variants b and c group the nav under small headings and drop
  // New task's rule.
  const prototype = useSidebarPrototypeVariant() !== "a";

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
      separatorAfter: !prototype,
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
      group: "records",
    },
    // Scoped by `?projectId=` like the rows above it, so `hrefFor` carries the
    // reader's project across without the studio knowing about the switcher.
    {
      key: "studio",
      href: "/studio",
      label: t("contentStudio"),
      Icon: ImagePlus,
      feature: AnnouncedFeature.CONTENT_STUDIO,
      group: "marketing",
    },
    // Social scheduling is public and follows the studio's project scope.
    {
      key: "social",
      href: "/social",
      label: prototype ? "Social posts" : t("social"),
      Icon: Share2,
      feature: AnnouncedFeature.SOCIAL,
      group: "marketing",
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
            group: "marketing" as const,
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
            group: "records" as const,
          },
        ]
      : []),
  ];

  const renderItem = ({
    key,
    href,
    label,
    Icon,
    onClick,
    separatorAfter,
    feature,
  }: MenuItemConfig) => {
    const isActive = href ? isPathActive(href) : false;
    // The pill wears the rail square's 4px inset and 4px padding
    // at every width, so collapsing only narrows it: its edge
    // and the + inside it stay where they are.
    const newTaskClassName =
      key === "new-task"
        ? "ml-1 w-[calc(100%-0.5rem)] pl-1 bg-secondary text-secondary-foreground hover:bg-secondary-hover hover:text-secondary-foreground active:bg-secondary-hover active:text-secondary-foreground data-[state=open]:hover:bg-secondary-hover data-[state=open]:hover:text-secondary-foreground group-data-[collapsible=icon]:hover:bg-secondary-hover group-data-[collapsible=icon]:active:bg-secondary-hover"
        : undefined;

    // Collapsed rail hides the label, so every item needs the hint.
    const tooltip = label;

    const content = (
      <>
        <SidebarRowSlot>
          <Icon className="size-4" aria-hidden />
        </SidebarRowSlot>
        <span
          className={cn(
            SIDEBAR_ROW_LABEL_CLASS,
            SIDEBAR_ROW_FIXED_LABEL_CLASS,
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
              data-sidebar-new-task={key === "new-task" ? "" : undefined}
              className={newTaskClassName}
              tooltip={tooltip}
            >
              <SheetClose asChild>
                <Link
                  href={hrefFor(href)}
                  onClick={() => feature && markFeatureSeen(feature)}
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
              data-sidebar-new-task={key === "new-task" ? "" : undefined}
              tooltip={tooltip}
              className={cn(
                newTaskClassName ??
                  "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              {content}
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
  };

  const inGroup = (group: MenuItemConfig["group"]) =>
    items.filter((item) => item.group === group);

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
            {(prototype
              ? items.filter(({ key }) => key === "new-task")
              : items
            ).map(renderItem)}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {prototype ? (
        <>
          {prototypeSokoBot}
          <SidebarGroup className="w-full px-2 py-0">
            <SidebarGroupContent className="pb-2">
              <NavPrototypeSection title="Work">
                {items
                  .filter(({ key, group }) => !group && key !== "new-task")
                  .map(renderItem)}
              </NavPrototypeSection>
              <NavPrototypeSection title="Records">
                {inGroup("records").map(renderItem)}
              </NavPrototypeSection>
              <NavPrototypeSection title="Marketing">
                {inGroup("marketing").map(renderItem)}
              </NavPrototypeSection>
            </SidebarGroupContent>
          </SidebarGroup>
        </>
      ) : null}
    </>
  );
}

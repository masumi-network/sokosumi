"use client";

import { AnnouncedFeature } from "@sokosumi/core-client";
import {
  Bot,
  HardDrive,
  ImagePlus,
  ListTodo,
  Megaphone,
  Repeat,
  Share2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, Suspense, type SVGProps } from "react";
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
import { cn } from "@/lib/utils";
import { useMarkFeatureSeen } from "./feature-badges";
import {
  SIDEBAR_FEATURE_LABEL_CLASS,
  SidebarFeatureLabel,
} from "./sidebar-feature-label";

interface MenuItemConfig {
  key: string;
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
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
  const { hrefFor } = useProjectScope();
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const markFeatureSeen = useMarkFeatureSeen();

  const isPathActive = (href: string) => {
    if (pathname === href) {
      return true;
    }

    return pathname.startsWith(`${href}/`);
  };

  const items: MenuItemConfig[] = [
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
          `SidebarMenuItem` is the same box a Chat row's is. */}
      <SidebarGroup className="w-full px-2 py-0">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0 py-2">
            {items.map(({ key, href, label, Icon, feature }) => {
              const isActive = isPathActive(href);

              return (
                <SidebarMenuItem key={key}>
                  <SidebarMenuButton asChild isActive={isActive}>
                    <SheetClose asChild>
                      <Link
                        href={hrefFor(href)}
                        onClick={() => feature && markFeatureSeen(feature)}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          isActive
                            ? "text-sidebar-accent-foreground"
                            : "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                      >
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
                            <SidebarFeatureLabel
                              label={label}
                              feature={feature}
                            />
                          ) : (
                            <span className="min-w-0 truncate">{label}</span>
                          )}
                        </span>
                      </Link>
                    </SheetClose>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

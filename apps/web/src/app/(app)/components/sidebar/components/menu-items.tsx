"use client";

import { AnnouncedFeature } from "@sokosumi/core-client";
import {
  Binoculars,
  Bot,
  CalendarDays,
  Clapperboard,
  FolderKanban,
  HardDrive,
  House,
  ImagePlus,
  ListTodo,
  Mail,
  Megaphone,
  Repeat,
  SearchCheck,
  Share2,
  Users,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ComponentType,
  type ReactNode,
  Suspense,
  type SVGProps,
  useState,
} from "react";
import { projectPageSection } from "@/app/components/project-scope/project-scope-href";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import {
  useIsUnknownScopeProject,
  useSelectedScopeProject,
} from "@/app/components/project-scope/use-scope-projects";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";
import { useNavPathname } from "@/components/navigation-progress.client";
import { RestingIntentLink } from "@/components/resting-intent-link";
import { Collapsible } from "@/components/ui/collapsible";
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
import {
  SIDEBAR_ROW_CLASS,
  SIDEBAR_ROW_LABEL_CLASS,
  SIDEBAR_ROW_LINK_CLASS,
} from "@/components/ui/sidebar-classes";
import {
  SidebarSectionContent,
  SidebarSectionTrigger,
} from "@/components/ui/sidebar-section";
import { cn } from "@/lib/utils";
import { isPathActive } from "@/lib/utils/is-path-active";
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
  /** An avatar drawn in the slot instead of `Icon`, sized like it. */
  tile?: ReactNode;
  /** The Badge campaign row this is, when the feature has one. */
  feature?: AnnouncedFeature;
  /**
   * A resting hover loads the page's content, not only its shell. Only for a
   * page whose reads are private-cached, or the prefetch renders for nothing.
   */
  prefetchContent?: true | undefined;
}

/** The headings the nav's destinations sit under, in the order they show. */
const NAV_GROUPS = ["work", "records", "marketing"] as const;

type NavGroup = (typeof NAV_GROUPS)[number];

/** A page the nav leads to. Each one says which heading it sits under. */
interface NavDestination extends MenuItemConfig {
  group: NavGroup;
  /** Left off the phone sheet, which reaches the page another way. */
  desktopOnly?: true;
  available?: boolean;
}

/**
 * `newsletterEnabled` is off by default so the Instant Nav shell, which has
 * not resolved workspace availability yet, leaves the row out rather than
 * guessing it: a row that appears once is cheaper than one that appears and
 * then goes away.
 */
export default function MenuItems({
  newsletterEnabled = false,
}: {
  newsletterEnabled?: boolean;
} = {}) {
  return (
    <Suspense fallback={null}>
      <ScopedMenuItems newsletterEnabled={newsletterEnabled} />
    </Suspense>
  );
}

export function useSidebarDestinations(newsletterEnabled: boolean) {
  const { projectId, hrefFor } = useProjectScope();
  const selectedProject = useSelectedScopeProject(projectId);
  // A deleted or foreign project has no page to open.
  const isUnknownProject = useIsUnknownScopeProject(projectId);
  const hasProjectPage = projectId !== null && !isUnknownProject;
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const navPathname = useNavPathname();
  const { isMobile } = useSidebar();
  const markFeatureSeen = useMarkFeatureSeen();

  const allDestinations: NavDestination[] = [
    // Desktop only: the phone's top bar leads to Home from its Sokosumi icon.
    {
      key: "home",
      href: "/",
      label: t("home"),
      Icon: House,
      group: "work",
      desktopOnly: true,
      prefetchContent: true,
    },
    {
      key: "overview",
      href: hasProjectPage
        ? `/projects/${encodeURIComponent(projectId)}`
        : "/projects",
      available: hasProjectPage,
      label: t("overview"),
      // The glyph holds the slot until the project's name and logo load.
      Icon: FolderKanban,
      tile: selectedProject ? (
        <ProjectAvatar
          name={selectedProject.name}
          logo={selectedProject.logo}
        />
      ) : undefined,
      group: "work",
      prefetchContent: true,
    },
    {
      key: "explore-agents",
      href: "/agents",
      label: t("exploreAgents"),
      Icon: Bot,
      feature: AnnouncedFeature.AGENTS,
      group: "work",
      prefetchContent: true,
    },
    {
      key: "task-manager",
      href: "/tasks",
      label: t("taskManager"),
      Icon: ListTodo,
      feature: AnnouncedFeature.TASKS,
      group: "work",
      prefetchContent: true,
    },
    {
      key: "schedules",
      href: TASK_SCHEDULES_PATH,
      label: t("schedules"),
      Icon: Repeat,
      feature: AnnouncedFeature.SCHEDULES,
      group: "work",
      prefetchContent: true,
    },
    // Every dated feature is a filter on this one page.
    {
      key: "calendar",
      href: "/calendar",
      label: t("calendar"),
      Icon: CalendarDays,
      group: "work",
      prefetchContent: true,
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
      prefetchContent: true,
    },
    // Talking videos, scoped by `?projectId=` like the studio beside it.
    {
      key: "tiktok-studio",
      href: "/tiktok-studio",
      label: t("tiktokStudio"),
      Icon: Clapperboard,
      group: "marketing",
      prefetchContent: true,
    },
    // Social scheduling is public and follows the studio's project scope.
    {
      key: "social",
      href: "/social",
      label: t("social"),
      Icon: Share2,
      feature: AnnouncedFeature.SOCIAL,
      group: "marketing",
      prefetchContent: true,
    },
    {
      key: "seo",
      href: "/seo",
      label: t("seo"),
      Icon: SearchCheck,
      group: "marketing",
      prefetchContent: true,
    },
    {
      key: "ads",
      href: "/ads",
      label: t("ads"),
      Icon: Megaphone,
      feature: AnnouncedFeature.SOCIAL,
      group: "marketing",
      prefetchContent: true,
    },
    // A project's competitors and its weekly check, scoped like Ads.
    {
      key: "competitors",
      href: "/competitors",
      label: t("competitors"),
      Icon: Binoculars,
      group: "marketing",
    },
    {
      key: "newsletter",
      href: "/newsletter",
      label: t("newsletter"),
      Icon: Mail,
      group: "marketing",
      available: newsletterEnabled,
    },
    // Desktop only: mobile keeps Files on the You page account surface.
    {
      key: "drive",
      href: "/drive",
      label: t("drive"),
      Icon: HardDrive,
      feature: AnnouncedFeature.DRIVE,
      group: "records",
      desktopOnly: true,
    },
  ];
  const destinations = allDestinations.map((item) => ({
    ...item,
    available: item.available !== false && !(isMobile && item.desktopOnly),
  }));

  function renderItem(
    { key, href, label, Icon, tile, feature, prefetchContent }: MenuItemConfig,
    newIndicator?: ReactNode,
    onOpen?: () => void,
  ) {
    // A click that heads for another project's page keeps the mark on
    // Overview: on arrival this row is that project's.
    const headsForProject =
      key === "overview" && projectPageSection(navPathname) !== null;
    const isActive = headsForProject || isPathActive(navPathname, href);

    return (
      <SidebarMenuItem key={key}>
        <SidebarMenuButton asChild isActive={isActive}>
          <SheetClose asChild>
            <RestingIntentLink
              href={hrefFor(href)}
              // The list on screen needs no prefetch of its own content. A
              // task detail page still marks Tasks active, so match exactly.
              prefetchContent={prefetchContent === true && pathname !== href}
              onClick={() => {
                if (feature) markFeatureSeen(feature);
                onOpen?.();
              }}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                isActive
                  ? "text-sidebar-accent-foreground"
                  : SIDEBAR_ROW_LINK_CLASS,
              )}
            >
              <SidebarRowSlot aria-hidden tile={tile !== undefined}>
                {tile ?? <Icon aria-hidden />}
              </SidebarRowSlot>
              <span
                className={cn(
                  SIDEBAR_ROW_LABEL_CLASS,
                  SIDEBAR_FEATURE_LABEL_CLASS,
                )}
              >
                {feature && !newIndicator ? (
                  <SidebarFeatureLabel label={label} feature={feature} />
                ) : (
                  <span className="min-w-0 truncate">{label}</span>
                )}
                {newIndicator}
              </span>
            </RestingIntentLink>
          </SheetClose>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return { destinations, renderItem };
}

function ScopedMenuItems({
  newsletterEnabled,
}: {
  newsletterEnabled: boolean;
}) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const { destinations, renderItem } =
    useSidebarDestinations(newsletterEnabled);
  return (
    // `px-2` here rather than on the item, so a nav row's `SidebarMenuItem`
    // is the same box a Chat row's is.
    <SidebarGroup className="w-full px-2 py-0">
      {/* 4px over Work, so the first heading sits just under the project
          title it hangs from. The 8px under the last group stacks on the
          Chats group's own 8px: that wider gap is what separates the
          project-scoped nav from the workspace-wide chats from md, where the
          scope's hairline is gone. */}
      <SidebarGroupContent className="pt-1 pb-2">
        {NAV_GROUPS.map((group) => (
          <MenuGroup key={group} title={t(`groups.${group}`)}>
            {destinations
              .filter(
                (destination) =>
                  destination.available && destination.group === group,
              )
              .map((destination) => renderItem(destination))}
          </MenuGroup>
        ))}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * A nav group under its heading, which folds it. Open on every load: the
 * state is in memory only, so a group folded away comes back on reload.
 */
function MenuGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={SIDEBAR_ROW_CLASS}>
        <SidebarSectionTrigger title={title} />
      </div>
      <SidebarSectionContent>
        <SidebarMenu className="gap-0">{children}</SidebarMenu>
      </SidebarSectionContent>
    </Collapsible>
  );
}

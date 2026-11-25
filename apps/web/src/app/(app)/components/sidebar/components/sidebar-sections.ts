import { AnnouncedFeature } from "@sokosumi/core-client";
import {
  Binoculars,
  Bot,
  CalendarDays,
  Clapperboard,
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
import type { ComponentType, SVGProps } from "react";
import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { isPathActive } from "@/lib/utils/is-path-active";

interface MenuItemConfig {
  key: string;
  href: string;
  labelKey: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** The Badge campaign row this is, when the feature has one. */
  feature?: AnnouncedFeature;
  /**
   * A resting hover loads the page's content, not only its shell. Only for a
   * page whose reads are private-cached, or the prefetch renders for nothing.
   */
  prefetchContent?: true | undefined;
}

/** The headings the nav's destinations sit under, in the order they show. */
export const NAV_GROUPS = [
  { id: "work", Icon: House },
  { id: "records", Icon: Users },
  { id: "marketing", Icon: Megaphone },
] as const;

type NavGroup = (typeof NAV_GROUPS)[number]["id"];

/** A page the nav leads to. Each one says which heading it sits under. */
interface NavDestination extends MenuItemConfig {
  group: NavGroup;
  /** Left off the phone sheet, which reaches the page another way. */
  desktopOnly?: true;
  requiresNewsletter?: true;
}

export const NAV_DESTINATIONS = [
  // Desktop only: the phone's top bar leads to Home from its Sokosumi icon.
  {
    key: "home",
    href: "/",
    labelKey: "home",
    Icon: House,
    group: "work",
    desktopOnly: true,
    prefetchContent: true,
  },
  {
    key: "explore-agents",
    href: "/agents",
    labelKey: "exploreAgents",
    Icon: Bot,
    feature: AnnouncedFeature.AGENTS,
    group: "work",
    prefetchContent: true,
  },
  {
    key: "task-manager",
    href: "/tasks",
    labelKey: "taskManager",
    Icon: ListTodo,
    feature: AnnouncedFeature.TASKS,
    group: "work",
    prefetchContent: true,
  },
  {
    key: "schedules",
    href: TASK_SCHEDULES_PATH,
    labelKey: "schedules",
    Icon: Repeat,
    feature: AnnouncedFeature.SCHEDULES,
    group: "work",
    prefetchContent: true,
  },
  // Every dated feature is a filter on this one page.
  {
    key: "calendar",
    href: "/calendar",
    labelKey: "calendar",
    Icon: CalendarDays,
    group: "work",
    prefetchContent: true,
  },
  // Workspace-wide like Files, so it is not scoped to the reader's project.
  {
    key: "contacts",
    href: "/contacts",
    labelKey: "contacts",
    Icon: Users,
    group: "records",
  },
  // Scoped by `?projectId=` like the rows above it, so `hrefFor` carries the
  // reader's project across without the studio knowing about the switcher.
  {
    key: "studio",
    href: "/studio",
    labelKey: "contentStudio",
    Icon: ImagePlus,
    feature: AnnouncedFeature.CONTENT_STUDIO,
    group: "marketing",
    prefetchContent: true,
  },
  // Talking videos, scoped by `?projectId=` like the studio beside it.
  {
    key: "tiktok-studio",
    href: "/tiktok-studio",
    labelKey: "tiktokStudio",
    Icon: Clapperboard,
    group: "marketing",
    prefetchContent: true,
  },
  // Social scheduling is public and follows the studio's project scope.
  {
    key: "social",
    href: "/social",
    labelKey: "social",
    Icon: Share2,
    feature: AnnouncedFeature.SOCIAL,
    group: "marketing",
    prefetchContent: true,
  },
  {
    key: "seo",
    href: "/seo",
    labelKey: "seo",
    Icon: SearchCheck,
    group: "marketing",
    prefetchContent: true,
  },
  {
    key: "ads",
    href: "/ads",
    labelKey: "ads",
    Icon: Megaphone,
    feature: AnnouncedFeature.SOCIAL,
    group: "marketing",
    prefetchContent: true,
  },
  // A project's competitors and its weekly check, scoped like Ads.
  {
    key: "competitors",
    href: "/competitors",
    labelKey: "competitors",
    Icon: Binoculars,
    group: "marketing",
  },
  {
    key: "newsletter",
    href: "/newsletter",
    labelKey: "newsletter",
    Icon: Mail,
    group: "marketing",
    requiresNewsletter: true,
  },
  // Mobile also keeps Files on the You page account surface.
  {
    key: "drive",
    href: "/drive",
    labelKey: "drive",
    Icon: HardDrive,
    feature: AnnouncedFeature.DRIVE,
    group: "records",
  },
] as const satisfies readonly NavDestination[];

export type SidebarDestination = NavDestination &
  (typeof NAV_DESTINATIONS)[number];

export type SidebarSection = NavGroup | "chats";

export function sidebarSection(pathname: string): SidebarSection | null {
  if (
    ["/chat", SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE].some((route) =>
      isPathActive(pathname, route),
    )
  ) {
    return "chats";
  }

  if (isPathActive(pathname, "/projects")) return "work";
  return (
    NAV_DESTINATIONS.find(({ href }) => isPathActive(pathname, href))?.group ??
    null
  );
}

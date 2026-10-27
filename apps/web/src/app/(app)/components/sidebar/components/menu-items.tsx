"use client";

import { AnnouncedFeature } from "@sokosumi/core-client";
import {
  Bot,
  HardDrive,
  House,
  ImagePlus,
  ListTodo,
  Mail,
  Megaphone,
  Repeat,
  Share2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ComponentType,
  type ReactNode,
  Suspense,
  type SVGProps,
  useState,
} from "react";
import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";
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
  /** The Badge campaign row this is, when the feature has one. */
  feature?: AnnouncedFeature;
}

/** The headings the nav's destinations sit under, in the order they show. */
const NAV_GROUPS = ["work", "records", "marketing"] as const;

type NavGroup = (typeof NAV_GROUPS)[number];

/** A page the nav leads to. Each one says which heading it sits under. */
interface NavDestination extends MenuItemConfig {
  group: NavGroup;
  /** Left off the phone sheet, which reaches the page another way. */
  desktopOnly?: true;
}

/**
 * `socialBetaEnabled` now gates Ads only; Social scheduling is public. It is off by default so
 * the Instant Nav shell, which has not resolved the reader's beta membership
 * yet, leaves the rows out rather than guessing them: a row that appears once
 * is cheaper than one that appears and then goes away.
 * Newsletter follows the same rule until workspace availability is resolved.
 */
export default function MenuItems({
  socialBetaEnabled = false,
  newsletterEnabled = false,
}: {
  socialBetaEnabled?: boolean;
  newsletterEnabled?: boolean;
} = {}) {
  return (
    <Suspense fallback={null}>
      <ScopedMenuItems
        socialBetaEnabled={socialBetaEnabled}
        newsletterEnabled={newsletterEnabled}
      />
    </Suspense>
  );
}

function ScopedMenuItems({
  socialBetaEnabled,
  newsletterEnabled,
}: {
  socialBetaEnabled: boolean;
  newsletterEnabled: boolean;
}) {
  const { hrefFor } = useProjectScope();
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const markFeatureSeen = useMarkFeatureSeen();

  const allDestinations: NavDestination[] = [
    // The phone's top bar leads to Home from its Sokosumi icon.
    {
      key: "home",
      href: "/",
      label: t("home"),
      Icon: House,
      group: "work",
      desktopOnly: true,
    },
    {
      key: "explore-agents",
      href: "/agents",
      label: t("exploreAgents"),
      Icon: Bot,
      feature: AnnouncedFeature.AGENTS,
      group: "work",
    },
    {
      key: "task-manager",
      href: "/tasks",
      label: t("taskManager"),
      Icon: ListTodo,
      feature: AnnouncedFeature.TASKS,
      group: "work",
    },
    {
      key: "schedules",
      href: TASK_SCHEDULES_PATH,
      label: t("schedules"),
      Icon: Repeat,
      feature: AnnouncedFeature.SCHEDULES,
      group: "work",
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
      label: t("social"),
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
            group: "marketing",
          } satisfies NavDestination,
        ]
      : []),
    ...(newsletterEnabled
      ? [
          {
            key: "newsletter",
            href: "/newsletter",
            label: t("newsletter"),
            Icon: Mail,
            group: "marketing",
          } satisfies NavDestination,
        ]
      : []),
    // The phone keeps Files on the You page account surface.
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
  const destinations = isMobile
    ? allDestinations.filter(({ desktopOnly }) => !desktopOnly)
    : allDestinations;

  function renderItem({ key, href, label, Icon, feature }: MenuItemConfig) {
    const isActive = isPathActive(pathname, href);

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
                  : SIDEBAR_ROW_LINK_CLASS,
              )}
            >
              <SidebarRowSlot>
                <Icon aria-hidden />
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
            </Link>
          </SheetClose>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    // `px-2` here rather than on the item, so a nav row's `SidebarMenuItem`
    // is the same box a Chat row's is.
    <SidebarGroup className="w-full px-2 py-0">
      {/* 4px over Work, so the first heading sits just under the project
          title it hangs from. */}
      <SidebarGroupContent className="pt-1 pb-2">
        {NAV_GROUPS.map((group) => (
          <MenuGroup key={group} title={t(`groups.${group}`)}>
            {destinations
              .filter((destination) => destination.group === group)
              .map(renderItem)}
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

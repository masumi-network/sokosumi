"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FolderKanban } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useId,
  useRef,
  useState,
} from "react";
import { loadMoreProjects } from "@/app/projects/actions";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRailSelectionBar,
  SidebarRowSlot,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_ROW_FIXED_LABEL_CLASS,
  SIDEBAR_ROW_LABEL_CLASS,
} from "@/components/ui/sidebar-classes";
import { Skeleton } from "@/components/ui/skeleton";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { usePinnedProjects } from "@/hooks/use-pinned-projects";
import {
  type RecentProjectsScope,
  useRecentProjectIds,
} from "@/hooks/use-recent-projects";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";

import { orderSidebarProjects } from "./order-sidebar-projects";

/**
 * Long enough that sweeping the pointer up the sidebar towards the logo does
 * not flash the panel open, short enough that aiming at the row feels direct.
 * Matches the chat participant hover card so both flyouts in the app answer
 * the pointer on the same beat.
 */
const FLYOUT_OPEN_DELAY_MS = 200;
const FLYOUT_CLOSE_DELAY_MS = 100;

/**
 * Opening the panel from the row, for a reader who is not holding a pointer.
 * Right matches the chevron and the side the panel comes out on; down is what
 * a menu button answers to, and costs nothing to accept as well.
 */
const FLYOUT_OPEN_KEYS = new Set(["ArrowRight", "ArrowDown"]);

export function ProjectsMenuItem() {
  const { data: session, isPending, isRefetching, error } = useSession();
  const scope =
    session && !isPending && !isRefetching && !error
      ? {
          userId: session.user.id,
          organizationId: session.session.activeOrganizationId ?? null,
        }
      : null;

  return <ProjectsNavigation key={JSON.stringify(scope)} scope={scope} />;
}

interface ProjectsNavigationProps {
  scope: RecentProjectsScope | null;
}

/**
 * All the flyout draws. Narrowed on purpose: Pinned rows arrive as
 * `StarredProject` and the rest as `ProjectListItem`, and the panel has no
 * business knowing which of the two a row came from.
 */
interface SidebarProject {
  id: string;
  name: string;
  logo: string | null;
}

/**
 * The reader's flyout rows, fetched as soon as the sidebar mounts rather than
 * when the pointer arrives, so the panel never opens onto a spinner.
 *
 * Caching is the app default (`get-query-client.ts`): one page stays fresh for
 * a minute and the observer here keeps it subscribed for as long as the
 * sidebar lives, so leaving and coming back is instant.
 */
function useSidebarProjects(scope: ProjectsNavigationProps["scope"]) {
  const visitedIds = useRecentProjectIds(scope);
  const pinned = usePinnedProjects(scope);
  const {
    data,
    isPending,
    isError,
    refetch: refetchActivity,
  } = useQuery({
    queryKey: [
      "sidebar-project-page",
      scope?.userId ?? null,
      scope?.organizationId ?? null,
    ],
    queryFn: () => {
      // `enabled` keeps this from running, but the guard is what proves it to
      // the type system without an assertion.
      if (!scope) throw new Error("No workspace scope");
      return loadMoreProjects({ cursor: null, expectedScope: scope });
    },
    enabled: scope != null,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Closed Pins stay on GET /starred so a project page can Unpin. They do not
  // belong in this popover — a closed project is on its way out of the list.
  const pinnedProjects = (pinned.data ?? []).filter(
    (project) => project.closedAt == null,
  );
  const { rows, pinnedCount } = orderSidebarProjects<SidebarProject>({
    // Pinned first, so a Pin outside the activity page is still resolvable.
    // `byId` dedupes, and the activity backfill skips whatever is taken.
    projects: [...pinnedProjects, ...(data?.projects ?? [])].map(
      ({ id, name, logo }) => ({ id, name, logo }),
    ),
    pinnedIds: pinnedProjects.map((project) => project.id),
    visitedIds,
  });

  // A session that has not resolved yet reads as pending, which is what the
  // flyout should show for it.
  return {
    rows,
    pinnedCount,
    // A Pin list still in flight must not paint an unpinned panel that
    // reshuffles a moment later.
    isPending: isPending || pinned.isPending || scope == null,
    isError: isError || pinned.isError,
    refetch() {
      void refetchActivity();
      void pinned.refetch();
    },
  };
}

function ProjectsNavigation({ scope }: ProjectsNavigationProps) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const { rows, pinnedCount, isPending, isError, refetch } =
    useSidebarProjects(scope);
  const active = pathname === "/projects" || pathname.startsWith("/projects/");
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const rowRef = useRef<HTMLAnchorElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openedByPointer = useRef(false);
  const interactedOutside = useRef(false);

  function clearPending() {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }

  // The pointer can leave with a timer still owing; unmounting behind it would
  // otherwise set state on a component that is gone.
  useMountEffect(() => clearPending);

  // Mounted while the page is still in flight so an early pointer lands on the
  // skeleton rather than on nothing.
  const mountsPanel = rows.length > 0 || isPending || isError;
  // Held back until there is a panel behind it. Promising one on the first
  // paint means retracting it on a workspace that turns out to have no
  // projects, and a row that changes shape under the reader is the twitch this
  // whole change exists to remove.
  const showsChevron = rows.length > 0 || isError;

  function handleNavigate() {
    if (isMobile) setOpenMobile(false);
  }

  // Which way the panel was opened decides who owns focus: a pointer must not
  // pull it off whatever the reader was typing in, and a keyboard open is
  // worthless unless focus follows into the rows.
  function openForPointer() {
    clearPending();
    openTimer.current = setTimeout(() => {
      openedByPointer.current = true;
      setOpen(true);
    }, FLYOUT_OPEN_DELAY_MS);
  }

  function closeForPointer() {
    clearPending();
    closeTimer.current = setTimeout(
      () => setOpen(false),
      FLYOUT_CLOSE_DELAY_MS,
    );
  }

  function handleRowKeyDown(event: ReactKeyboardEvent<HTMLAnchorElement>) {
    if (!mountsPanel || !FLYOUT_OPEN_KEYS.has(event.key)) return;
    // Enter is left alone, so the row still navigates the way a link should.
    event.preventDefault();
    clearPending();
    openedByPointer.current = false;
    interactedOutside.current = false;
    setOpen(true);
  }

  const row = (
    // On the rail the panel is the hover hint, so a tooltip would race it to
    // the same spot. Without a panel there is nothing else to name the icon,
    // so the tooltip stays.
    <SidebarMenuButton
      asChild
      isActive={active}
      tooltip={mountsPanel ? undefined : t("projects")}
    >
      <Link
        ref={rowRef}
        href="/projects"
        onClick={handleNavigate}
        onPointerEnter={mountsPanel ? openForPointer : undefined}
        onPointerLeave={mountsPanel ? closeForPointer : undefined}
        onKeyDown={handleRowKeyDown}
        aria-expanded={mountsPanel ? open : undefined}
        aria-current={pathname === "/projects" ? "page" : undefined}
        className={cn(
          "min-w-0",
          active
            ? "text-sidebar-accent-foreground"
            : "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <SidebarRowSlot>
          <FolderKanban className="size-4" aria-hidden />
        </SidebarRowSlot>
        <span
          className={cn(SIDEBAR_ROW_LABEL_CLASS, SIDEBAR_ROW_FIXED_LABEL_CLASS)}
        >
          {t("projects")}
        </span>
        {showsChevron ? (
          // Points at the panel rather than at an open/closed state, so it
          // needs no state of its own and never animates the row.
          <ChevronRight
            className="size-4 shrink-0 group-data-[collapsible=icon]:hidden"
            aria-hidden
          />
        ) : null}
      </Link>
    </SidebarMenuButton>
  );

  return (
    <SidebarMenuItem>
      {mountsPanel ? (
        <Popover open={open} onOpenChange={setOpen} modal={false}>
          <PopoverAnchor asChild>{row}</PopoverAnchor>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={8}
            className="w-56 p-1"
            aria-labelledby={headingId}
            // A pointer open leaves focus where it was; a keyboard open sends
            // it into the rows, which is the whole point of opening that way.
            onOpenAutoFocus={(event) => {
              if (openedByPointer.current) event.preventDefault();
            }}
            // Radix would restore to a trigger we do not have. Escape should
            // land back on the row; a click or focus outside should not —
            // there is no trigger, so Radix also no longer withholds that
            // restore after an outside interaction.
            onInteractOutside={() => {
              interactedOutside.current = true;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (interactedOutside.current) {
                interactedOutside.current = false;
                return;
              }
              if (!openedByPointer.current) rowRef.current?.focus();
            }}
            onPointerEnter={clearPending}
            onPointerLeave={closeForPointer}
          >
            {/* Names the panel itself, for a reader on the rail where
                nothing else does. Its own name, not the row's echoed back,
                and not one of the group names either: calling the whole panel
                "Recent projects" would mislabel the Pinned rows inside it,
                which is exactly what a lone divider let happen on screen. */}
            <p id={headingId} className="sr-only">
              {t("projectsPanel")}
            </p>
            {isPending ? (
              <ProjectLinksSkeleton label={t("projectsLoading")} />
            ) : isError ? (
              <div className="px-2 py-1.5">
                <p role="status" className="text-muted-foreground text-sm">
                  {t("projectsError")}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void refetch()}
                >
                  {t("retryProjects")}
                </Button>
              </div>
            ) : (
              <ProjectLinks
                rows={rows}
                pinnedCount={pinnedCount}
                labels={{
                  pinned: t("pinnedProjects"),
                  recent: t("recentProjects"),
                }}
                onNavigate={handleNavigate}
              />
            )}
            {/* A way out of the panel without aiming back at the row behind
                it. No avatar: the placeholder square only read as a project
                whose logo had failed to load. The padding holds its text on the
                name column all the same, so the footer does not hang left of
                every row above it. */}
            <div className="bg-border my-1 h-px" />
            <Link
              href="/projects"
              onClick={handleNavigate}
              className="text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground block rounded-md py-1.5 pr-2 pl-9 text-sm outline-hidden focus-visible:ring-2"
            >
              {t("allProjects")}
            </Link>
          </PopoverContent>
        </Popover>
      ) : (
        row
      )}
      {active ? <SidebarRailSelectionBar /> : null}
    </SidebarMenuItem>
  );
}

/**
 * Ragged widths, so the placeholder reads as a list of names rather than a
 * stack of identical bars — the trick `SidebarChatListSkeleton` uses. The
 * panel floats, so its height costs the sidebar nothing and the count is a
 * constant rather than an estimate of what is coming.
 */
const SKELETON_NAME_WIDTHS = ["w-24", "w-16", "w-28", "w-20", "w-14"] as const;

function ProjectLinksSkeleton({ label }: { label: string }) {
  return (
    <SidebarMenuSub className="mx-0 translate-x-0 gap-0 border-l-0 p-0">
      <p role="status" className="sr-only">
        {label}
      </p>
      {SKELETON_NAME_WIDTHS.map((nameWidth) => (
        <SidebarMenuSubItem key={nameWidth} aria-hidden>
          <div className="flex min-h-9 items-center gap-2 px-2 py-2">
            <Skeleton className="size-5 shrink-0 rounded-md" />
            <Skeleton className={cn("h-3", nameWidth)} />
          </div>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  );
}

function ProjectLinks({
  rows,
  pinnedCount,
  labels,
  onNavigate,
}: {
  rows: SidebarProject[];
  pinnedCount: number;
  labels: { pinned: string; recent: string };
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const pinned = rows.slice(0, pinnedCount);
  const recent = rows.slice(pinnedCount);

  function group(
    projects: SidebarProject[],
    label: string | null,
    headingId: string,
  ) {
    if (projects.length === 0) return null;

    return (
      <>
        {label ? (
          <p
            id={headingId}
            className="text-muted-foreground px-2 py-1.5 text-xs font-medium"
          >
            {label}
          </p>
        ) : null}
        <SidebarMenuSub
          aria-labelledby={label ? headingId : undefined}
          className="mx-0 translate-x-0 gap-0 border-l-0 p-0"
        >
          {projects.map((project) => {
            const href = `/projects/${encodeURIComponent(project.id)}`;
            const selected =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <SidebarMenuSubItem key={project.id}>
                <SidebarMenuSubButton
                  asChild
                  isActive={selected}
                  className={cn(
                    "min-h-9 h-auto translate-x-0 px-2 py-2",
                    selected
                      ? "text-sidebar-accent-foreground"
                      : "text-tertiary-foreground dark:text-muted-foreground hover:text-sidebar-accent-foreground dark:hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Link
                    href={href}
                    prefetch={false}
                    onClick={onNavigate}
                    aria-current={selected ? "page" : undefined}
                    title={project.name}
                  >
                    <span aria-hidden className="shrink-0">
                      <ProjectAvatar
                        name={project.name}
                        logo={project.logo}
                        className="size-5"
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {project.name}
                    </span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      </>
    );
  }

  // With no Pins there is nothing to tell apart, so the single list carries
  // the plain heading on its own.
  if (pinnedCount === 0) {
    return group(recent, labels.recent, "sidebar-projects-recent");
  }

  return (
    <>
      {group(pinned, labels.pinned, "sidebar-projects-pinned")}
      {group(recent, labels.recent, "sidebar-projects-recent")}
    </>
  );
}

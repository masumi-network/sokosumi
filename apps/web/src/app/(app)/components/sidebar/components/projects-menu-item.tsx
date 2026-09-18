"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FolderKanban } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { loadMoreProjects } from "@/app/projects/actions";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SIDEBAR_ROW_LABEL_CLASS,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRailSelectionBar,
  SidebarRowSlot,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  type RecentProjectsScope,
  useRecentProjectIds,
} from "@/hooks/use-recent-projects";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";

import { orderSidebarProjects } from "./order-sidebar-projects";

const PROJECTS_EXPANDED_STORAGE_KEY = "sokosumi.sidebar.projects-expanded";

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

type SidebarProject = Awaited<
  ReturnType<typeof loadMoreProjects>
>["projects"][number];

/**
 * The reader's sidebar rows, fetched as soon as the sidebar mounts rather than
 * when the disclosure opens, so opening it never lands on a spinner.
 *
 * Caching is the app default (`get-query-client.ts`): one page stays fresh for
 * a minute and the observer here keeps it subscribed for as long as the
 * sidebar lives, so collapsing and coming back is instant.
 */
function useSidebarProjects(scope: ProjectsNavigationProps["scope"]) {
  const visitedIds = useRecentProjectIds(scope);
  const { data, isPending, isError, refetch } = useQuery({
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

  const rows = orderSidebarProjects({
    projects: data?.projects ?? [],
    // Pins arrive with the Core pin routes; the rule they plug into is already
    // covered in `order-sidebar-projects.test.ts`.
    pinnedIds: [],
    visitedIds,
  });

  // A session that has not resolved yet reads as pending, which is what the
  // disclosure should show for it.
  return { rows, isPending: isPending || scope == null, isError, refetch };
}

function ProjectsNavigation({ scope }: ProjectsNavigationProps) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const { isMobile, state, setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  useMountEffect(() => {
    try {
      setOpen(localStorage.getItem(PROJECTS_EXPANDED_STORAGE_KEY) === "true");
    } catch {
      // Keep disclosure usable when browser storage is blocked.
    }
  });

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    try {
      localStorage.setItem(PROJECTS_EXPANDED_STORAGE_KEY, String(nextOpen));
    } catch {
      // Persistence is optional; the in-memory choice still works.
    }
  }

  const { rows, isPending, isError, refetch } = useSidebarProjects(scope);
  const active = pathname === "/projects" || pathname.startsWith("/projects/");
  const expandedSidebar = isMobile || state !== "collapsed";

  // The control holds its place from the first paint and turns on once there
  // is something behind it, so the row never changes shape under the reader.
  // A workspace with no projects keeps a disabled chevron rather than losing
  // one. A reader who left it open gets it live while their rows load, so the
  // skeleton and the retry are never trapped open.
  const disclosable = rows.length > 0 || isError || (open && isPending);

  function handleNavigate() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    <SidebarMenuItem>
      <Collapsible
        open={open && expandedSidebar && disclosable}
        onOpenChange={handleOpenChange}
      >
        <div
          className={cn(
            "flex items-center rounded-md",
            active && expandedSidebar && "bg-sidebar-accent",
          )}
        >
          <SidebarMenuButton asChild isActive={active} tooltip={t("projects")}>
            <Link
              href="/projects"
              onClick={handleNavigate}
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
              <span className={cn(SIDEBAR_ROW_LABEL_CLASS, "truncate")}>
                {t("projects")}
              </span>
            </Link>
          </SidebarMenuButton>
          {expandedSidebar ? (
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!disclosable}
                className="size-10 shrink-0 md:size-8 text-tertiary-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:text-muted-foreground"
                aria-label={t(open ? "collapseProjects" : "expandProjects")}
              >
                <ChevronRight
                  className={cn(
                    "size-4 transition-transform duration-200 ease-out",
                    open && "rotate-90",
                  )}
                  aria-hidden
                />
              </Button>
            </CollapsibleTrigger>
          ) : null}
        </div>
        {active ? <SidebarRailSelectionBar /> : null}
        {/* Height travels with the rows, so everything below slides in the
            same motion instead of jumping. */}
        <CollapsibleContent className="motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down overflow-hidden">
          {isPending ? (
            <ProjectLinksSkeleton label={t("projectsLoading")} />
          ) : isError ? (
            <SidebarMenuSub className="mx-0 translate-x-0 border-l-0 pl-4 pr-0">
              <SidebarMenuSubItem>
                <p role="status" className="text-muted-foreground px-2 text-sm">
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
              </SidebarMenuSubItem>
            </SidebarMenuSub>
          ) : (
            <ProjectLinks rows={rows} onNavigate={handleNavigate} />
          )}
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

/**
 * Stands in for the rows on a first paint the reader opened into, at the same
 * geometry, so the disclosure does not resize once the names arrive.
 */
const SKELETON_NAME_WIDTHS = ["w-24", "w-16", "w-20"] as const;

function ProjectLinksSkeleton({ label }: { label: string }) {
  return (
    <SidebarMenuSub className="mx-0 translate-x-0 border-l-0 pl-4 pr-0">
      <p role="status" className="sr-only">
        {label}
      </p>
      {SKELETON_NAME_WIDTHS.map((nameWidth) => (
        <SidebarMenuSubItem key={nameWidth} aria-hidden>
          <div className="flex min-h-9 items-center gap-2 py-2">
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
  onNavigate,
}: {
  rows: SidebarProject[];
  onNavigate: () => void;
}) {
  const pathname = usePathname();

  return (
    <SidebarMenuSub className="mx-0 translate-x-0 border-l-0 pl-4 pr-0">
      {rows.map((project) => {
        const href = `/projects/${encodeURIComponent(project.id)}`;
        const selected = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <SidebarMenuSubItem key={project.id}>
            <SidebarMenuSubButton
              asChild
              isActive={selected}
              className={cn(
                "min-h-9 h-auto translate-x-0 py-2",
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
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
              </Link>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        );
      })}
    </SidebarMenuSub>
  );
}

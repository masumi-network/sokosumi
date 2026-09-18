"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight, FolderKanban } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { loadMoreProjects } from "@/app/projects/actions";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";
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
import { useLoadWhenVisible } from "@/hooks/use-load-when-visible";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";

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
  scope: { userId: string; organizationId: string | null } | null;
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

  function handleToggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    try {
      localStorage.setItem(PROJECTS_EXPANDED_STORAGE_KEY, String(nextOpen));
    } catch {
      // Persistence is optional; the in-memory choice still works.
    }
  }

  const contentId = useId();
  const active = pathname === "/projects" || pathname.startsWith("/projects/");
  const expandedSidebar = isMobile || state !== "collapsed";

  function handleNavigate() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    <SidebarMenuItem>
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 md:size-8 text-tertiary-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:text-muted-foreground"
            aria-label={t(open ? "collapseProjects" : "expandProjects")}
            aria-expanded={open}
            aria-controls={contentId}
            onClick={handleToggle}
          >
            <ChevronRight
              className={cn("size-4", open && "rotate-90")}
              aria-hidden
            />
          </Button>
        ) : null}
      </div>
      {active ? <SidebarRailSelectionBar /> : null}
      <div id={contentId} hidden={!open || !expandedSidebar}>
        {open && expandedSidebar ? (
          scope ? (
            <ProjectLinks scope={scope} onNavigate={handleNavigate} />
          ) : (
            <p
              role="status"
              className="text-muted-foreground px-6 py-2 text-sm"
            >
              {t("projectsLoading")}
            </p>
          )
        ) : null}
      </div>
    </SidebarMenuItem>
  );
}

function ProjectLinks({
  scope,
  onNavigate,
}: {
  scope: NonNullable<ProjectsNavigationProps["scope"]>;
  onNavigate: () => void;
}) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const pathname = usePathname();
  const boundaryRef = useRef<HTMLLIElement>(null);
  const {
    data,
    isPending,
    isError,
    isFetchingNextPage,
    isFetchNextPageError,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["sidebar-project-pages", scope.userId, scope.organizationId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      loadMoreProjects({ cursor: pageParam, expectedScope: scope }),
    getNextPageParam: (page) => page.nextCursor,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const projects = [
    ...new Map(
      data?.pages
        .flatMap((page) => page.projects)
        .map((project) => [project.id, project]),
    ).values(),
  ];
  function handleLoadMore() {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }
  useLoadWhenVisible(boundaryRef, {
    armed: Boolean(hasNextPage && !isFetchingNextPage && !isError),
    boundaryKey: data?.pages.at(-1)?.nextCursor ?? "end",
    onVisible: handleLoadMore,
  });

  return (
    <SidebarMenuSub
      className="mx-0 max-h-64 translate-x-0 overflow-y-auto border-l-0 pl-8 pr-0"
      onScroll={(event) => {
        const list = event.currentTarget;
        if (list.scrollHeight - list.scrollTop - list.clientHeight < 48)
          handleLoadMore();
      }}
    >
      {!isError &&
        projects.map((project, index) => {
          const href = `/projects/${encodeURIComponent(project.id)}`;
          const selected = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <SidebarMenuSubItem
              key={project.id}
              className="[content-visibility:auto] [contain-intrinsic-size:auto_36px]"
            >
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
                  onFocus={
                    index === projects.length - 1 ? handleLoadMore : undefined
                  }
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
      <SidebarMenuSubItem ref={boundaryRef}>
        <p role="status" className="text-muted-foreground px-2 text-sm">
          {isPending || isFetchingNextPage
            ? t("projectsLoading")
            : isError
              ? t("projectsError")
              : projects.length === 0
                ? t("projectsEmpty")
                : null}
        </p>
        {isError ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              void (isFetchNextPageError ? fetchNextPage() : refetch())
            }
          >
            {t("retryProjects")}
          </Button>
        ) : null}
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, FolderKanban } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { loadMoreProjects } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRailSelectionBar,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";

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
              "min-h-auto min-w-0 gap-2 px-3",
              active
                ? "text-sidebar-accent-foreground"
                : "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <FolderKanban className="size-4" aria-hidden />
            <span className="flex-1 truncate group-data-[collapsible=icon]:sr-only">
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
            onClick={() => setOpen(!open)}
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
  // Mounted only by disclosure. One page, no retained workspace cache or
  // background polling; the overview owns pagination for larger collections.
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["sidebar-projects", scope.userId, scope.organizationId],
    queryFn: () => loadMoreProjects({ cursor: null, expectedScope: scope }),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return (
    <SidebarMenuSub className="max-h-64 overflow-y-auto">
      <SidebarMenuSubItem>
        <p role="status" className="text-muted-foreground px-2 text-sm">
          {isPending
            ? t("projectsLoading")
            : isError
              ? t("projectsError")
              : data?.projects.length === 0
                ? t("projectsEmpty")
                : null}
        </p>
        {isError ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refetch()}
          >
            {t("retryProjects")}
          </Button>
        ) : null}
      </SidebarMenuSubItem>
      {!isError &&
        data?.projects.map((project) => {
          const href = `/projects/${encodeURIComponent(project.id)}`;
          const selected = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <SidebarMenuSubItem key={project.id}>
              <SidebarMenuSubButton
                asChild
                isActive={selected}
                className="min-h-9 h-auto py-2"
              >
                <Link
                  href={href}
                  prefetch={false}
                  onClick={onNavigate}
                  aria-current={selected ? "page" : undefined}
                  title={project.name}
                >
                  {selected ? (
                    <Check className="size-4 shrink-0" aria-hidden />
                  ) : null}
                  <span>{project.name}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          );
        })}
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild className="min-h-9 h-auto py-2">
          <Link href="/projects" onClick={onNavigate}>
            {t("viewAllProjects")}
          </Link>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  );
}

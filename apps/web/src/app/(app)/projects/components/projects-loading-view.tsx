import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import {
  PROJECTS_BROWSE_CARD_CLASS,
  PROJECTS_BROWSE_HEADER_ROW_CLASS,
  PROJECTS_BROWSE_LIST_CLASS,
  PROJECTS_CARD_CLASS,
  PROJECTS_CARD_LAYOUT_CLASS,
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_OPEN_LAYOUT_CLASS,
  PROJECTS_PAGE_SHELL_CLASS,
} from "@/app/projects/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { WorkspaceColumnSkeleton } from "./workspace-column-skeleton";

/**
 * Sync Instant Nav shell for `/projects`.
 * Mirrors `ProjectsView` chrome so the Instant swap stays stable.
 * No user-facing copy (locale flash) — desktop create is a non-textual skeleton.
 */
export function ProjectsPageSkeleton() {
  return (
    <div className={PROJECTS_PAGE_SHELL_CLASS}>
      <ProjectsLoadingView />
    </div>
  );
}

export function ProjectsLoadingView() {
  return (
    <div
      data-testid="projects-loading"
      className={cn("flex flex-col gap-5", LIST_MOBILE_CREATE_FAB_CLEARANCE)}
    >
      <div
        data-testid="projects-loading-toolbar"
        className={PROJECTS_BROWSE_HEADER_ROW_CLASS}
      >
        <Skeleton className="h-10 min-w-0 flex-1 rounded-md" />
        {/* The Open / Closed control: two segments, no copy (locale flash). */}
        <Skeleton
          data-testid="projects-loading-state"
          className="h-10 w-36 shrink-0 rounded-md"
        />
        <Skeleton
          data-testid="projects-loading-create"
          className="hidden h-10 w-[8.25rem] shrink-0 rounded-md md:inline-flex"
        />
      </div>
      {/* Open is the default view, so the shell carries its column. */}
      <div className={PROJECTS_OPEN_LAYOUT_CLASS}>
        <WorkspaceColumnSkeleton />
        <div className="min-w-0">
          {/* min-h matches empty/browse so Instant / empty swap does not thrash CLS. */}
          <div
            data-testid="projects-loading-browse"
            className={cn(
              PROJECTS_BROWSE_CARD_CLASS,
              PROJECTS_LIST_CARD_MIN_H_CLASS,
            )}
          >
            <div className={PROJECTS_BROWSE_LIST_CLASS}>
              {Array.from({ length: 6 }, (_, index) => (
                <ProjectListItemSkeleton key={index} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Match `ProjectListItem` card geometry (content-visibility + 136px intrinsic)
 * so Instant swap does not thrash layout metrics.
 */
function ProjectListItemSkeleton() {
  return (
    <article className={cn(PROJECTS_CARD_LAYOUT_CLASS, PROJECTS_CARD_CLASS)}>
      <div className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <Skeleton className="h-4 w-40 max-w-full" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>

        {/* One pill, not two: the jobs pill is dropped at zero, so most cards
            carry a single count plus the activity stamp. */}
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-10 rounded-full" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    </article>
  );
}

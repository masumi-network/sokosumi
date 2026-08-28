import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import {
  PROJECTS_BROWSE_DIVIDE_CLASS,
  PROJECTS_BROWSE_LAYOUT_CLASS,
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_LIST_ROW_LAYOUT_CLASS,
  PROJECTS_PAGE_SHELL_CLASS,
} from "@/app/projects/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
        data-testid="projects-loading-create"
        className="hidden justify-end md:flex"
      >
        {/* Matches sm Button footprint without English (or other locale) text. */}
        <Skeleton className="h-8 w-[7.25rem] rounded-md" />
      </div>

      {/* min-h matches empty/browse so Instant / empty swap does not thrash CLS. */}
      <div
        data-testid="projects-loading-browse"
        className={cn(
          PROJECTS_BROWSE_LAYOUT_CLASS,
          PROJECTS_LIST_CARD_MIN_H_CLASS,
        )}
      >
        <div className={PROJECTS_BROWSE_DIVIDE_CLASS}>
          {Array.from({ length: 4 }, (_, index) => (
            <ProjectListItemSkeleton key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Match `ProjectListItem` row geometry (content-visibility + 72px intrinsic)
 * so Instant swap does not thrash layout metrics.
 */
function ProjectListItemSkeleton() {
  return (
    <article className={PROJECTS_LIST_ROW_LAYOUT_CLASS}>
      <div className="-mx-2 flex min-w-0 flex-row items-center gap-4 rounded-none px-2 py-3 md:rounded-lg">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Skeleton className="h-5 w-10 rounded-full" />
          <Skeleton className="h-5 w-10 rounded-full" />
        </div>
      </div>
    </article>
  );
}

import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import {
  PROJECTS_BROWSE_DIVIDE_CLASS,
  PROJECTS_BROWSE_HEADER_ROW_CLASS,
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
      {/* min-h matches empty/browse so Instant / empty swap does not thrash CLS. */}
      <div
        data-testid="projects-loading-browse"
        className={cn(
          PROJECTS_BROWSE_LAYOUT_CLASS,
          PROJECTS_LIST_CARD_MIN_H_CLASS,
        )}
      >
        {/* Shares the live header row class so the Instant swap does not drop
            the rows by its height. Skeletons only: no copy, so no locale
            flash. Each child mirrors one live control's footprint and
            breakpoint band. */}
        <div className={PROJECTS_BROWSE_HEADER_ROW_CLASS}>
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="inline-block h-3 w-32 shrink-0 md:hidden lg:inline-block" />
          {/* Matches sm Button footprint without English (or other locale)
              text. Desktop only, like the live create control. */}
          <Skeleton
            data-testid="projects-loading-create"
            className="hidden h-8 w-[7.25rem] shrink-0 rounded-md md:block"
          />
        </div>

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
      <div className="flex min-w-0 flex-row items-center gap-4 rounded-none px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>

        {/* One pill, not two: the jobs pill is dropped at zero, so most rows
            carry a single count plus the activity stamp. */}
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-5 w-10 rounded-full" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    </article>
  );
}

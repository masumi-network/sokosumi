import { Plus } from "lucide-react";

import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import {
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_LIST_ROW_LAYOUT_CLASS,
} from "@/app/projects/constants";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ProjectsLoadingViewLabels {
  newProject: string;
}

interface ProjectsLoadingViewProps {
  labels: ProjectsLoadingViewLabels;
}

/** Sync shell labels for Instant Navigations / `loading.tsx` (no cookies/i18n). */
export const PROJECTS_LOADING_DEFAULT_LABELS: ProjectsLoadingViewLabels = {
  newProject: "New project",
};

/**
 * Sync Instant Nav shell for `/projects`.
 * Mirrors `ProjectsView` chrome so the Instant swap stays stable.
 */
export function ProjectsPageSkeleton() {
  return (
    <div className="w-full px-2">
      <ProjectsLoadingView labels={PROJECTS_LOADING_DEFAULT_LABELS} />
    </div>
  );
}

export function ProjectsLoadingView({ labels }: ProjectsLoadingViewProps) {
  return (
    <div
      data-testid="projects-loading"
      className={cn("flex flex-col gap-5", LIST_MOBILE_CREATE_FAB_CLEARANCE)}
    >
      <div className="hidden justify-end md:flex">
        <Button size="sm" className="self-start gap-1.5" disabled>
          <Plus className="size-4" aria-hidden />
          {labels.newProject}
        </Button>
      </div>

      {/* min-h matches empty/list cards so Instant / empty swap does not thrash CLS. */}
      <div
        className={cn(
          "bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border",
          PROJECTS_LIST_CARD_MIN_H_CLASS,
        )}
      >
        <div
          data-testid="projects-loading-list"
          className="divide-border/50 divide-y px-2"
        >
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
    <article
      className={cn(
        "-mx-2 flex items-center gap-1 rounded-lg px-2",
        PROJECTS_LIST_ROW_LAYOUT_CLASS,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 px-2 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
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

      <div className="shrink-0 pl-2">
        <Skeleton className="size-8 rounded-md" />
      </div>
    </article>
  );
}

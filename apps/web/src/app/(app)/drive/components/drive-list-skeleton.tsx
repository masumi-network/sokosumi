import type { ReactElement } from "react";

import {
  driveItemArticleClass,
  driveItemBodyClass,
  driveItemIconWellClass,
  driveItemMetaMobileClass,
  driveItemsListClass,
  driveItemsPanelClass,
} from "@/app/drive/components/drive-view-layout";
import { Skeleton } from "@/components/ui/skeleton";
import type { FilesViewMode } from "@/lib/ui-preferences/files-view-mode";

interface DriveListSkeletonProps {
  viewMode?: FilesViewMode;
}

export function DriveListSkeleton({
  viewMode = "list",
}: DriveListSkeletonProps): ReactElement {
  if (viewMode === "grid") {
    return (
      <div
        className={driveItemsPanelClass("grid")}
        data-testid="files-layout-skeleton-grid"
      >
        <div className={driveItemsListClass("grid")}>
          {Array.from({ length: 8 }).map((_, i) => (
            <article key={i} className={driveItemArticleClass("grid")}>
              <div className={driveItemBodyClass("grid")}>
                <div className={driveItemIconWellClass("grid")}>
                  <Skeleton className="size-4" />
                </div>
                <Skeleton className="h-4 w-24" />
                <div className={driveItemMetaMobileClass("grid")}>
                  <Skeleton className="h-3 w-10" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <div className="shrink-0 pl-1">
                <Skeleton className="size-8" />
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={driveItemsPanelClass("list")}
      data-testid="files-layout-skeleton-list"
    >
      <div className={driveItemsListClass("list")}>
        {Array.from({ length: 4 }).map((_, i) => (
          <article key={i} className={driveItemArticleClass("list")}>
            <div className={driveItemBodyClass("list")}>
              <div className={driveItemIconWellClass("list")}>
                <Skeleton className="size-4" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Skeleton className="h-4 w-32 sm:w-48" />
                <div className="text-muted-foreground/70 flex items-center gap-3 text-xs md:hidden">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <div className="text-muted-foreground/70 hidden shrink-0 items-center gap-3 text-xs md:flex">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="shrink-0 pl-2">
              <Skeleton className="size-8" />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

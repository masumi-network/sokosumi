import type { ReactElement } from "react";

import {
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_LIST_ROW_LAYOUT_CLASS,
} from "@/app/projects/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function DriveListSkeleton(): ReactElement {
  return (
    <div
      className={cn(
        "bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border",
        PROJECTS_LIST_CARD_MIN_H_CLASS,
      )}
    >
      <div className="divide-border/50 divide-y px-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <article
            key={i}
            className={cn(
              "-mx-2 flex items-center gap-1 rounded-lg px-2",
              PROJECTS_LIST_ROW_LAYOUT_CLASS,
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-4 py-3 px-2">
              <div className="flex size-8 shrink-0 items-center justify-center">
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

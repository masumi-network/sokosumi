import {
  WORKSPACE_COLUMN_ROWS,
  WORKSPACE_COLUMN_STACKED_ROWS,
} from "@/app/projects/constants";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** One panel while its feed loads: the live panel's geometry, no copy. */
export function WorkspaceColumnPanelSkeleton({ testId }: { testId: string }) {
  return (
    <div
      data-testid={testId}
      aria-hidden
      className={cn(HOLDER_CLASS, "flex flex-col gap-2")}
    >
      <div className="flex min-h-6 items-center px-2">
        <Skeleton className="h-3 w-20" />
      </div>
      <div
        className={cn(
          HOLDER_ITEM_CLASS,
          "divide-border flex flex-col divide-y",
        )}
      >
        {Array.from({ length: WORKSPACE_COLUMN_ROWS }, (_, index) => (
          <div
            key={index}
            className={cn(
              "flex items-start gap-2.5 px-3 py-2",
              index >= WORKSPACE_COLUMN_STACKED_ROWS && "max-xl:hidden",
            )}
          >
            <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-3 w-8 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Both panels, for the Instant shell. */
export function WorkspaceColumnSkeleton() {
  return (
    <div
      data-testid="workspace-column-loading"
      className="flex min-w-0 flex-col gap-5"
    >
      <WorkspaceColumnPanelSkeleton testId="workspace-needs-you-loading" />
      <WorkspaceColumnPanelSkeleton testId="workspace-activity-loading" />
    </div>
  );
}

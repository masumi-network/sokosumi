import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Sync Instant Nav shell for `/connections` (no cookies/`connection()`/i18n).
 * Mirrors social-account rows + tab strip + list card.
 */
export function ConnectionsPageSkeleton(): React.ReactElement {
  return (
    <div data-testid="connections-loading" className="min-h-full w-full">
      <div className={cn(HOLDER_CLASS, "space-y-6 p-3")}>
        <div className="space-y-6">
          <div className="space-y-3" data-testid="connections-loading-sign-in">
            <div className="space-y-1">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-4 w-56" />
            </div>
            <div
              data-testid="connections-loading-social"
              className="flex flex-col divide-y rounded-xl border py-2"
            >
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} className="flex items-center gap-2 px-4 py-4">
                  <Skeleton className="size-6 shrink-0 rounded-full" />
                  <Skeleton className="h-4 flex-1 max-w-40" />
                  <Skeleton className="size-9 shrink-0 rounded-md" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div
              data-testid="connections-loading-tabs"
              className="bg-card-background flex w-full max-w-xs items-center gap-1 self-start rounded-lg p-1"
            >
              <Skeleton className="h-8 flex-1 rounded-md" />
              <Skeleton className="h-8 flex-1 rounded-md" />
            </div>

            <div
              data-testid="connections-loading-content"
              className="bg-card-background border-border overflow-hidden rounded-xl border"
            >
              <div className="divide-border divide-y">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="flex items-center gap-3 p-4">
                    <Skeleton className="size-8 shrink-0 rounded-md" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-8 w-20 shrink-0 rounded-md" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

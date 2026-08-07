import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/connections` (no cookies/`connection()`/i18n).
 * Mirrors social-account rows + tab strip + list card.
 */
export function ConnectionsPageSkeleton(): React.ReactElement {
  return (
    <div data-testid="connections-loading" className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4">
        <div className="space-y-6">
          <div
            data-testid="connections-loading-social"
            className="flex flex-col divide-y rounded-xl border p-2"
          >
            {Array.from({ length: 2 }, (_, index) => (
              <div key={index} className="flex items-center gap-2 px-2 py-4">
                <Skeleton className="size-6 shrink-0 rounded-full" />
                <Skeleton className="h-4 flex-1 max-w-40" />
                <Skeleton className="size-9 shrink-0 rounded-md" />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-5">
            <div
              data-testid="connections-loading-tabs"
              className="bg-muted/50 flex w-full max-w-xs items-center gap-1 self-start rounded-lg p-1"
            >
              <Skeleton className="h-8 flex-1 rounded-md" />
              <Skeleton className="h-8 flex-1 rounded-md" />
            </div>

            <div
              data-testid="connections-loading-content"
              className="bg-muted/30 border-border/50 overflow-hidden rounded-xl border"
            >
              <div className="divide-border/50 divide-y">
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

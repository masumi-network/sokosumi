import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/notifications` (no cookies/`connection()`/i18n).
 * Mirrors the in-page list loading card (5 rows).
 */
export function NotificationsPageSkeleton(): React.ReactElement {
  return (
    <div
      data-testid="notifications-loading"
      className="flex flex-col gap-5 pb-4"
    >
      <div className="bg-muted/30 border-border/50 overflow-hidden rounded-xl border">
        <div
          data-testid="notifications-loading-list"
          className="divide-border/50 divide-y"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

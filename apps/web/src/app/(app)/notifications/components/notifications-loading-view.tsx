import { Skeleton } from "@/components/ui/skeleton";

/**
 * The rows themselves, without a frame, so the live list can wear the same
 * bones inside the card it is already in.
 * Sync only (no cookies/`connection()`/i18n).
 */
export function NotificationsSkeletonRows(): React.ReactElement {
  return (
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
  );
}

/** List card bones for Instant `loading.tsx`. */
export function NotificationsListSkeleton(): React.ReactElement {
  return (
    <div className="bg-muted/30 border-border/50 overflow-hidden rounded-xl border">
      <NotificationsSkeletonRows />
    </div>
  );
}

/**
 * Sync Instant Nav shell for `/notifications`.
 */
export function NotificationsPageSkeleton(): React.ReactElement {
  return (
    <div
      data-testid="notifications-loading"
      className="flex flex-col gap-5 pb-4"
    >
      <NotificationsListSkeleton />
    </div>
  );
}

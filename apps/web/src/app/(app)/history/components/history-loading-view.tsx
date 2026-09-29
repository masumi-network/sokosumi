import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/history` (no cookies/`connection()`/i18n).
 * Mirrors toolbar + list layout of the Search tab destination.
 */
export function HistoryPageSkeleton(): React.ReactElement {
  return (
    <div className="w-full">
      <div className="mx-auto flex w-full flex-col gap-6 pb-6">
        <div
          data-testid="history-loading-toolbar"
          className="flex items-center gap-2 sm:gap-3"
        >
          <Skeleton className="h-10 min-w-0 flex-1 rounded-md" />
          <Skeleton className="size-10 shrink-0 rounded-md" />
        </div>
        <ul
          data-testid="history-loading-list"
          className="bg-card-background flex flex-col gap-2 rounded-xl p-2"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <li
              key={index}
              className="bg-background flex items-start gap-3 rounded-lg border border-border p-3"
            >
              <Skeleton className="size-8 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-full max-w-48" />
                <Skeleton className="h-3 w-full max-w-md" />
                <Skeleton className="h-3 w-24" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

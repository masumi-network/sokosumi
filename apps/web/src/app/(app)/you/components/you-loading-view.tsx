import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/you` (no cookies/`connection()`/i18n).
 * Mirrors the live You page: left-aligned identity header + section list.
 */
export function YouPageSkeleton(): React.ReactElement {
  return (
    <div
      className="mx-auto w-full py-6 md:max-w-4xl md:py-8"
      data-testid="you-loading"
    >
      <div className="space-y-6">
        <header
          data-testid="you-loading-identity"
          className="flex w-full items-start gap-4"
        >
          <Skeleton className="size-16 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-28" />
          </div>
        </header>
        <div data-testid="you-loading-credits" className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-1.5 w-full rounded-full" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
        <ul data-testid="you-loading-menu" className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index}>
              <Skeleton className="h-12 w-full rounded-lg" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

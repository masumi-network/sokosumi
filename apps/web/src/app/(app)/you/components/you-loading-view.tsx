import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/you` (no cookies/`connection()`/i18n).
 * Mirrors identity header + section list layout of the You page.
 */
export function YouPageSkeleton(): React.ReactElement {
  return (
    <div
      className="mx-auto flex w-full flex-col gap-6 py-6 md:max-w-4xl md:py-8"
      data-testid="you-loading"
    >
      <div
        data-testid="you-loading-identity"
        className="flex items-start gap-4"
      >
        <Skeleton className="size-16 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <div data-testid="you-loading-credits" className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-full" />
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
  );
}

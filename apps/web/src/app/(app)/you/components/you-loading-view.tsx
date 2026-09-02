import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/you` (no cookies/`connection()`/i18n).
 * Mirrors identity header + section list layout of the You page.
 */
export function YouPageSkeleton(): React.ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pb-8">
      <div
        data-testid="you-loading-identity"
        className="flex flex-col items-center gap-3 pt-4"
      >
        <Skeleton className="size-20 rounded-full" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-full max-w-xs rounded-md" />
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

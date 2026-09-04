import { Skeleton } from "@/components/ui/skeleton";

/** Sync Instant Nav shell for stacked menu screens (no cookies/`connection()`). */
export function MobileStackedMenuSkeleton(): React.ReactElement {
  return (
    <div
      className="mx-auto w-full py-6 md:max-w-4xl md:py-8"
      data-testid="mobile-stacked-menu-loading"
    >
      <div className="space-y-6">
        <Skeleton className="h-6 w-32" />
        <ul className="flex flex-col gap-2">
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

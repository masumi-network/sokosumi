import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/` (no cookies/`connection()`/i18n).
 *
 * Bones of the Soko Bot Home, on the same column and spacing as
 * `SokoBotHomeComposer`: the bot's face over the greeting, the composer, three
 * suggestion chips, then a section heading and a few rows. One layout serves
 * every breakpoint, as the page does, so the swap to content does not jump.
 * The retired coworker picker's faces drew a screen Home no longer shows.
 */
export function ChatHomePageSkeleton(): React.ReactElement {
  return (
    <div
      className="flex min-h-full w-full min-w-0 flex-1 flex-col items-center px-4"
      data-testid="home-loading"
      // Bones only: a screen reader would read an empty list of three items.
      aria-hidden
    >
      <div className="flex w-full max-w-3xl flex-col gap-8 pt-4 md:pt-[22dvh]">
        <div className="flex flex-col items-center gap-5">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-9 w-64 max-w-full md:h-10" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton
            className="h-24 w-full rounded-xl"
            data-testid="home-loading-composer"
          />
          <div
            className="flex flex-wrap justify-center gap-2"
            data-testid="home-loading-chips"
          >
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-8 w-36 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
        </div>
      </div>
      <div className="w-full max-w-3xl pt-10 pb-10 md:pt-16">
        <Skeleton className="mx-3 mb-4 h-4 w-40" />
        <ul
          className="flex flex-col gap-4 px-3"
          data-testid="home-loading-list"
        >
          <li className="flex items-center gap-3">
            <Skeleton className="size-4 shrink-0 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16 shrink-0" />
          </li>
          <li className="flex items-center gap-3">
            <Skeleton className="size-4 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="ms-auto h-4 w-16 shrink-0" />
          </li>
          <li className="flex items-center gap-3">
            <Skeleton className="size-4 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="ms-auto h-4 w-16 shrink-0" />
          </li>
        </ul>
      </div>
    </div>
  );
}

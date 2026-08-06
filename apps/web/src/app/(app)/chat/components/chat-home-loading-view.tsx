import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/chat` (no cookies/`connection()`/i18n).
 * Mirrors page split: mobile Home hub list + desktop welcome.
 */
export function ChatHomePageSkeleton(): React.ReactElement {
  return (
    <>
      <div
        data-testid="chat-home-loading-mobile"
        className="-m-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto bg-background p-4 md:hidden"
      >
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 py-2">
            <Skeleton className="size-5 shrink-0 rounded-md" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
      <div
        data-testid="chat-home-loading-desktop"
        className="mx-auto hidden w-full max-w-2xl flex-col items-center gap-6 px-4 py-12 md:flex"
      >
        <div className="flex w-full flex-col items-center gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-12 w-full max-w-xl rounded-xl" />
        <div className="flex flex-wrap justify-center gap-2">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
        </div>
      </div>
    </>
  );
}

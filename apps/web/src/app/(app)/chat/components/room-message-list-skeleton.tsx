import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const MESSAGE_SKELETON_ROWS = 6;

/**
 * Outer padding for room message list content (skeleton + live).
 * Instant loading and progressive shell must share this exactly so the gap
 * above the composer does not shrink on paint swaps.
 */
export const ROOM_MESSAGE_LIST_CONTENT_CLASSNAME =
  "flex min-h-full min-w-0 w-full flex-col justify-end px-5 pt-6 pb-0";

/**
 * Message-list only skeleton for progressive room open.
 * Real header + composer paint with the shell; only history is deferred.
 * No extra padding — parent uses ROOM_MESSAGE_LIST_CONTENT_CLASSNAME.
 */
export function RoomMessageListSkeleton({
  className,
}: {
  className?: string;
} = {}): React.ReactElement {
  return (
    <div
      data-slot="room-message-list-skeleton"
      data-testid="room-message-list-skeleton"
      className={cn("flex min-w-0 w-full flex-col gap-5", className)}
      aria-hidden
    >
      {Array.from({ length: MESSAGE_SKELETON_ROWS }, (_, index) => (
        <div
          key={index}
          className={cn(
            "flex gap-3",
            index % 3 === 1 ? "flex-row-reverse" : "flex-row",
          )}
        >
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div
            className={cn(
              "min-w-0 space-y-2",
              index % 2 === 0 ? "w-[min(100%,18rem)]" : "w-[min(100%,14rem)]",
            )}
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

/** The label widths the bones use, so no two rows read as one block. */
const ROW_WIDTHS = ["w-[72%]", "w-[58%]", "w-[80%]", "w-[64%]"];

/**
 * Loading shell for the Threads and All unreads views (SOK-1159), in their
 * geometry: the 32px heading line, then rows of an 18px-and-up mark beside
 * a label line over a room line. Without its own shell either route would
 * paint the `/chat` segment's Chats list skeleton, which is a different page.
 * Sync only (no cookies/`connection()`/i18n).
 */
export function ChatUnreadViewSkeleton() {
  return (
    <div
      data-testid="chat-unread-view-loading"
      className="flex flex-col gap-5 pb-4"
      aria-hidden
    >
      <Skeleton className="h-8 w-40" />
      <div className="flex flex-col gap-1">
        {ROW_WIDTHS.map((width) => (
          <div key={width} className="flex items-start gap-2.5 px-2 py-2">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Skeleton className={`h-5 ${width}`} />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

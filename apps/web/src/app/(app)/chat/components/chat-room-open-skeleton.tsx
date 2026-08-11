import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "@/app/chat/chat-message-list-scroller";
import { CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS } from "@/app/chat/components/chat-mobile-tab-registry";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const MESSAGE_SKELETON_ROWS = 6;

/**
 * Pulse bones for the room message list while history is still loading.
 * No invented copy or half-rendered markdown — only layout placeholders.
 * Padding is owned by the parent scroller (RoomsClient content / Instant shell).
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
      className={cn(
        "flex min-w-0 w-full flex-col justify-end gap-5",
        className,
      )}
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

/**
 * Sync Instant / outer-Suspense shell for `/chat/rooms/[roomId]`.
 *
 * SOK-778: only the **message list** is skeleton. Real header + composer paint
 * with the room shell (not here) — no fake composer bones (looks wrong, CLS).
 * No cookies, connection(), or i18n.
 */
export function ChatRoomOpenSkeleton(): React.ReactElement {
  return (
    <div
      data-testid="chat-room-loading"
      data-slot="chat-room-open-skeleton"
      className={cn(
        "-m-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
        CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS,
      )}
    >
      {/* Desktop header slot only — no pulse labels (real chrome comes with shell). */}
      <div
        data-slot="chat-room-open-skeleton-header"
        className="hidden h-16 shrink-0 border-b md:block"
        aria-hidden
      />

      <div className={CHAT_MESSAGE_LIST_SCROLLER_CLASS}>
        <div className="flex min-h-full min-w-0 w-full flex-col justify-end">
          <RoomMessageListSkeleton className="px-5 pt-6 pb-4" />
        </div>
      </div>
    </div>
  );
}

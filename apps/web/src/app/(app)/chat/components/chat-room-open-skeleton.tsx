import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "@/app/chat/chat-message-list-scroller";
import {
  CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS,
  chatMobileComposerSafeAreaPbClass,
} from "@/app/chat/components/chat-mobile-tab-registry";
import {
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME,
} from "@/components/chat/room-message-composer";
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
 * Matches live `RoomMessageComposer` chrome geometry (padding, card, editor
 * min height, tool row, safe-area). Instant → real composer must not grow the
 * footer and shove the message list.
 */
export function RoomComposerSkeleton({
  className,
}: {
  className?: string;
} = {}): React.ReactElement {
  return (
    <div
      data-slot="chat-room-open-skeleton-composer"
      data-testid="chat-room-composer-skeleton"
      className={cn(
        // Same outer inset as room `RoomComposer` → `RoomMessageComposer`.
        "shrink-0 px-3 pt-2 md:px-5 md:pt-3",
        chatMobileComposerSafeAreaPbClass(false),
        className,
      )}
      aria-hidden
    >
      <div className="border-border overflow-hidden rounded-xl border bg-background">
        {/* Format strip bone: desktop default open (SOK-681). Hidden on mobile
            so Instant height matches resolveFormatToolbarOpenOnMount. */}
        <div className="border-border bg-muted/20 hidden items-center gap-0.5 overflow-x-auto border-b px-2 py-1.5 md:flex">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="size-8 shrink-0 rounded-md" />
          ))}
        </div>
        {/* Editor: same min-h / vertical padding as ROOM_COMPOSER_TEXTAREA. */}
        <div
          className={cn(
            ROOM_COMPOSER_TEXTAREA_CLASSNAME,
            "pointer-events-none",
          )}
        >
          <Skeleton className="h-6 w-2/3 max-w-full rounded-md" />
        </div>
        {/* Tool row: attach / format / emoji / mention + send. */}
        <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Skeleton className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME} />
            <Skeleton className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME} />
            <Skeleton className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME} />
            <Skeleton className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME} />
          </div>
          <Skeleton className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME} />
        </div>
      </div>
    </div>
  );
}

/**
 * Sync Instant / outer-Suspense shell for `/chat/rooms/[roomId]`.
 * No cookies, connection(), or i18n — header + message bones + composer bones.
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
      <header
        data-slot="chat-room-open-skeleton-header"
        className="hidden h-16 shrink-0 items-center justify-between gap-4 border-b px-6 md:flex"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="size-8 rounded-full" />
        </div>
      </header>

      <div className={CHAT_MESSAGE_LIST_SCROLLER_CLASS}>
        {/* min-h-full + justify-end: match live RoomsClient so Instant → shell
            does not jump the message bones from top to bottom. */}
        <div className="flex min-h-full min-w-0 w-full flex-col justify-end">
          <RoomMessageListSkeleton className="px-5 pt-6 pb-4" />
        </div>
      </div>

      <RoomComposerSkeleton />
    </div>
  );
}

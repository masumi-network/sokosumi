"use client";

import { ALargeSmall, AtSign, Bold, Italic, Paperclip } from "lucide-react";

import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "@/app/chat/chat-message-list-scroller";
import { CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS } from "@/app/chat/components/chat-mobile-tab-registry";
import { RoomMessageListSkeleton } from "@/app/chat/components/room-message-list-skeleton";
import {
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME,
  RoomMessageComposer,
} from "@/components/chat/room-message-composer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Instant / Suspense fallback for room open: **real** composer chrome +
 * message-list skeleton. No full-page spinner and no pulse fake composer.
 *
 * Sync-safe for Instant: no room data, cookies, or i18n. Disabled controls only.
 * Progressive shell swaps in room-aware header/composer after meta loads.
 */
export function RoomOpenLoadingView(): React.ReactElement {
  return (
    <div
      data-testid="chat-room-loading"
      data-slot="chat-room-open-loading"
      className={cn(
        "-m-4 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS,
      )}
    >
      {/* Desktop header slot — real title paints with the progressive shell. */}
      <div
        data-slot="chat-room-open-loading-header"
        className="hidden h-16 shrink-0 border-b md:block"
        aria-hidden
      />

      <div className={CHAT_MESSAGE_LIST_SCROLLER_CLASS}>
        <div className="flex min-h-full min-w-0 w-full flex-col justify-end">
          <RoomMessageListSkeleton className="px-5 pt-6 pb-4" />
        </div>
      </div>

      <RoomMessageComposer
        onSubmit={(event) => {
          event.preventDefault();
        }}
        attachments={[]}
        onRemoveAttachment={() => {
          /* no-op: Instant shell is non-interactive */
        }}
        removeAttachmentLabel={() => ""}
        isSending={false}
        sendDisabled
        sendAriaLabel="Send"
        withOuterPadding={false}
        withSafeAreaPadding
        className="px-3 pt-2 md:px-5 md:pt-3"
        aboveEditor={
          // Desktop default often shows the format strip (SOK-681) — reserve
          // the same row so shell paint does not grow the footer.
          <div
            className="border-border bg-muted/20 hidden items-center gap-0.5 overflow-x-auto border-b px-2 py-1.5 md:flex"
            aria-hidden
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              disabled
              tabIndex={-1}
            >
              <Bold className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              disabled
              tabIndex={-1}
            >
              <Italic className="size-4" aria-hidden />
            </Button>
          </div>
        }
        toolbarStart={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
              disabled
              tabIndex={-1}
              aria-hidden
            >
              <Paperclip className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
              disabled
              tabIndex={-1}
              aria-hidden
            >
              <ALargeSmall className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
              disabled
              tabIndex={-1}
              aria-hidden
            >
              <AtSign className="size-4" aria-hidden />
            </Button>
          </>
        }
      >
        <div
          className={cn(
            ROOM_COMPOSER_TEXTAREA_CLASSNAME,
            "pointer-events-none",
          )}
          aria-hidden
        />
      </RoomMessageComposer>
    </div>
  );
}

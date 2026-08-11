"use client";

import { ALargeSmall, AtSign, Paperclip, SmilePlus } from "lucide-react";
import { useLayoutEffect, useState } from "react";

import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "@/app/chat/chat-message-list-scroller";
import { CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS } from "@/app/chat/components/chat-mobile-tab-registry";
import {
  ROOM_MESSAGE_LIST_CONTENT_CLASSNAME,
  RoomMessageListSkeleton,
} from "@/app/chat/components/room-message-list-skeleton";
import {
  getFormatToolbarOpenPreference,
  resolveFormatToolbarOpenOnMount,
} from "@/app/chat/utils/format-toolbar-preference-storage";
import { ComposerFormatToolbar } from "@/components/chat/composer-format-toolbar";
import {
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME,
  RoomMessageComposer,
} from "@/components/chat/room-message-composer";
import { Button } from "@/components/ui/button";
import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Instant / Suspense fallback for room open: **real** composer chrome +
 * message-list skeleton. Toolbars mirror live `RoomComposer` so shell paint
 * does not swap icons (format strip + attach / Aa / emoji / mention).
 *
 * No room data, cookies, or interaction — disabled controls only.
 */
export function RoomOpenLoadingView(): React.ReactElement {
  // Same default + layout-effect preference as live RoomComposer (SOK-681).
  const [formatToolbarOpen, setFormatToolbarOpen] = useState(false);
  useLayoutEffect(() => {
    setFormatToolbarOpen(
      resolveFormatToolbarOpenOnMount({
        stored: getFormatToolbarOpenPreference(),
        viewportWidth: window.innerWidth,
        mobileBreakpoint: MOBILE_BREAKPOINT,
      }),
    );
  }, []);

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

      <div className={cn(CHAT_MESSAGE_LIST_SCROLLER_CLASS, "flex flex-col")}>
        {/* Same content chrome as progressive RoomsClient list (no extra pb). */}
        <div className={ROOM_MESSAGE_LIST_CONTENT_CLASSNAME}>
          <RoomMessageListSkeleton />
        </div>
      </div>

      <div className="pointer-events-none" aria-hidden>
        <RoomMessageComposer
          onSubmit={(event) => {
            event.preventDefault();
          }}
          attachments={[]}
          onRemoveAttachment={() => {
            /* no-op */
          }}
          removeAttachmentLabel={() => ""}
          isSending={false}
          sendDisabled
          sendAriaLabel="Send"
          withOuterPadding={false}
          withSafeAreaPadding
          className="px-3 pt-2 md:px-5 md:pt-3"
          aboveEditor={
            formatToolbarOpen ? (
              <ComposerFormatToolbar
                onFormat={() => {
                  /* no-op */
                }}
                onLink={() => {
                  /* no-op */
                }}
              />
            ) : null
          }
          toolbarStart={
            <>
              {/* Order matches live RoomComposer: attach, Aa, emoji, mention */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
                disabled
                tabIndex={-1}
              >
                <Paperclip className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME,
                  formatToolbarOpen && "bg-muted text-foreground",
                )}
                disabled
                tabIndex={-1}
                aria-pressed={formatToolbarOpen}
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
              >
                <SmilePlus className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
                disabled
                tabIndex={-1}
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
          />
        </RoomMessageComposer>
      </div>
    </div>
  );
}

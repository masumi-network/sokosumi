"use client";

import { ALargeSmall, AtSign, Paperclip, SmilePlus } from "lucide-react";
import { useLayoutEffect, useState } from "react";

import { RoomMessageListSkeleton } from "@/app/chat/components/room-message-list-skeleton";
import { RoomShellLayout } from "@/app/chat/components/room-shell-layout";
import {
  getFormatToolbarOpenPreference,
  resolveFormatToolbarOpenOnMount,
} from "@/app/chat/utils/format-toolbar-preference-storage";
import { ComposerFormatToolbar } from "@/components/chat/composer-format-toolbar";
import {
  ROOM_COMPOSER_EDITOR_PLACEHOLDER_CLASSNAME,
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME,
  RoomMessageComposer,
} from "@/components/chat/room-message-composer";
import { Button } from "@/components/ui/button";
import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Instant / Suspense fallback: same shell tree as progressive RoomsClient +
 * real composer chrome + left-aligned message-list skeleton.
 *
 * Disabled + aria-hidden so missing/invalid rooms do not flash a usable send
 * control before redirect. Generic `data-placeholder=" "` so empty:before
 * cannot steal mobile LCP from real chrome.
 */
export function RoomOpenLoadingView(): React.ReactElement {
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
    <RoomShellLayout
      testId="chat-room-loading"
      dataSlot="chat-room-open-loading"
      reserveDesktopHeader
      desktopHeader={null}
      listContent={<RoomMessageListSkeleton />}
      composer={
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
            {/*
              Structural twin of ComposerWysiwygEditor empty host: same min-h
              + empty:before placeholder geometry (no contenteditable / i18n
              room name — generic bone only).
            */}
            <div
              className={cn(
                ROOM_COMPOSER_TEXTAREA_CLASSNAME,
                ROOM_COMPOSER_EDITOR_PLACEHOLDER_CLASSNAME,
                "pointer-events-none",
              )}
              data-placeholder=" "
            />
          </RoomMessageComposer>
        </div>
      }
    />
  );
}

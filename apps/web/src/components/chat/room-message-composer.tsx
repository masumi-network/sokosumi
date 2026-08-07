"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import {
  type FocusEvent,
  type FormEvent,
  type ReactNode,
  type Ref,
  useState,
} from "react";

import { chatMobileComposerSafeAreaPbClass } from "@/app/chat/components/chat-mobile-tab-registry";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { Button } from "@/components/ui/button";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import { cn } from "@/lib/utils";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";

export const ROOM_COMPOSER_TEXTAREA_CLASSNAME = withEditableTextSize(
  "max-h-40 min-h-10 field-sizing-content resize-none overflow-y-auto rounded-none border-0! bg-transparent px-4 pt-3.5 pb-2.5 leading-6 ring-0 outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent",
);

export const ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME =
  "size-9 rounded-full sm:size-8";

export const ROOM_COMPOSER_MENTION_ANCHOR_ATTR =
  "data-room-composer-mention-anchor";

export interface RoomMessageComposerAttachment {
  url: string;
  fileName: string;
  mediaType?: string | null;
}

interface RoomMessageComposerProps {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  attachments: RoomMessageComposerAttachment[];
  onRemoveAttachment: (attachment: RoomMessageComposerAttachment) => void;
  removeAttachmentLabel: (fileName: string) => string;
  children: ReactNode;
  toolbarStart?: ReactNode;
  /**
   * Formatting strip above the editor body (after attachment chips).
   */
  aboveEditor?: ReactNode;
  isSending: boolean;
  sendDisabled: boolean;
  sendAriaLabel: string;
  /** When set, replaces the send button (e.g. stop while streaming). */
  submitControl?: ReactNode;
  /**
   * Channel-style outer padding. Prefer true as the single padding source;
   * set false only when a parent already applies the same inset.
   */
  withOuterPadding?: boolean;
  /**
   * Mobile/desktop safe-area `pb-*`. Defaults with `withOuterPadding`.
   * Set true when the parent supplies horizontal/top padding only (room).
   * Dropped while the soft keyboard is open or an editable inside is focused
   * (iOS often fails geometry-only detection on focus).
   */
  withSafeAreaPadding?: boolean;
  formRef?: Ref<HTMLFormElement | null>;
  className?: string;
  /** Extra row between editor and toolbar (chips, image-gen, etc.). */
  belowEditor?: ReactNode;
  sendButtonTestId?: string;
}

/**
 * Presentational room composer chrome shared by channels and coworker DMs:
 * bordered card, attachment chips, toolbar tools, primary round ArrowUp send.
 */
export function RoomMessageComposer({
  onSubmit,
  attachments,
  onRemoveAttachment,
  removeAttachmentLabel,
  children,
  toolbarStart,
  aboveEditor,
  isSending,
  sendDisabled,
  sendAriaLabel,
  submitControl,
  withOuterPadding = true,
  withSafeAreaPadding = withOuterPadding,
  formRef,
  className,
  belowEditor,
  sendButtonTestId,
}: RoomMessageComposerProps) {
  const keyboardOpen = useKeyboardOpen();
  const [composerFocused, setComposerFocused] = useState(false);
  // Focus is the reliable iOS signal; geometry covers Android / blur races.
  const collapseSafeArea = keyboardOpen || composerFocused;

  function handleFocusCapture() {
    setComposerFocused(true);
  }

  function handleBlurCapture(event: FocusEvent<HTMLFormElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return;
    }
    setComposerFocused(false);
  }

  return (
    <form
      ref={formRef}
      className={cn(
        "shrink-0",
        withOuterPadding && "px-5 pt-2 md:pt-3",
        withSafeAreaPadding &&
          chatMobileComposerSafeAreaPbClass(collapseSafeArea),
        className,
      )}
      onSubmit={onSubmit}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      <div className="w-full">
        <div
          className="border-border overflow-hidden rounded-xl border bg-background"
          data-room-composer-mention-anchor
        >
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-4 pt-4">
              {attachments.map((attachment) => (
                <FileChipMiniPreviewWithMetadata
                  key={attachment.url}
                  url={attachment.url}
                  fileName={attachment.fileName}
                  mediaType={attachment.mediaType}
                  sizeClass="size-16"
                  onRemove={() => onRemoveAttachment(attachment)}
                  removeLabel={removeAttachmentLabel(attachment.fileName)}
                />
              ))}
            </div>
          ) : null}
          {aboveEditor}
          {children}
          {belowEditor}
          <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
            <div className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
              {toolbarStart}
            </div>
            {submitControl ?? (
              <Button
                type="submit"
                variant="primary"
                size="icon"
                className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
                disabled={isSending || sendDisabled}
                aria-label={sendAriaLabel}
                data-testid={sendButtonTestId}
              >
                {isSending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <ArrowUp className="size-4" aria-hidden />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

interface RoomComposerEmojiPickerProps {
  onPick: (emoji: string) => void;
  title: string;
  ariaLabel: string;
}

export function RoomComposerEmojiPicker({
  onPick,
  title,
  ariaLabel,
}: RoomComposerEmojiPickerProps) {
  return (
    <EmojiPicker
      onPick={onPick}
      title={title}
      ariaLabel={ariaLabel}
      align="start"
      triggerClassName={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
    />
  );
}

"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import {
  type FormEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useRef,
} from "react";

import { chatMobileComposerSafeAreaPbClass } from "@/app/chat/components/chat-mobile-tab-registry";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { Button } from "@/components/ui/button";
import { MENTION_ANCHOR_SCROLL_MARGIN_TOP_PX } from "@/components/ui/mention-textarea-utils";
import { recordEmojiUse } from "@/hooks/use-frequently-used-emojis";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";

const POINTER_SUBMIT_CLICK_GUARD_MS = 400;

/**
 * Shared footprint for the live editor and Instant loading shell.
 * The editable font sizes supply 1.5rem / 1.25rem line heights. Symmetric
 * padding keeps a single line at 3rem without tightening multiline drafts.
 */
export const ROOM_COMPOSER_TEXTAREA_CLASSNAME = withEditableTextSize(
  "box-border max-h-40 min-h-12 field-sizing-content resize-none overflow-y-auto rounded-none border-0! bg-transparent px-4 py-3 md:py-3.5 ring-0 outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent",
);

/**
 * Keep ellipsis without a scroll container: overflow-hidden gives the empty
 * caret the wrong baseline in Gecko (https://bugzilla.mozilla.org/show_bug.cgi?id=904846#c51).
 * The host owns the height in both the live editor and Instant loading shell.
 */
export const ROOM_COMPOSER_EDITOR_PLACEHOLDER_CLASSNAME =
  "empty:before:pointer-events-none empty:before:block empty:before:max-w-full empty:before:overflow-clip empty:before:text-ellipsis empty:before:whitespace-nowrap empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]";

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
   * Runs before pointer/keyboard Send calls `requestSubmit` (e.g. flush
   * trailing emoticons when Send skips editor blur).
   */
  onPrepareSubmit?: () => void;
  /**
   * Channel-style outer padding. Prefer true as the single padding source;
   * set false only when a parent already applies the same inset.
   */
  withOuterPadding?: boolean;
  /**
   * Mobile/desktop safe-area `pb-*`. Defaults with `withOuterPadding`.
   * Set true when the parent supplies horizontal/top padding only (room).
   * Dropped only while the soft keyboard is open (editable focus + viewport
   * shrink) — not on iOS autofocus alone, which does not open the OSK.
   */
  withSafeAreaPadding?: boolean;
  formRef?: Ref<HTMLFormElement | null>;
  className?: string;
  /** Extra row between editor and toolbar (chips, image-gen, etc.). */
  belowEditor?: ReactNode;
  /**
   * Clustered with Send on the toolbar's trailing edge (character count).
   */
  toolbarEnd?: ReactNode;
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
  onPrepareSubmit,
  withOuterPadding = true,
  withSafeAreaPadding = withOuterPadding,
  formRef,
  className,
  belowEditor,
  toolbarEnd,
  sendButtonTestId,
}: RoomMessageComposerProps) {
  const keyboardOpen = useKeyboardOpen();
  const sendBlocked = isSending || sendDisabled;
  return (
    <form
      ref={formRef}
      className={cn(
        "shrink-0",
        withOuterPadding && "px-5 pt-2 md:pt-3",
        withSafeAreaPadding && chatMobileComposerSafeAreaPbClass(keyboardOpen),
        className,
      )}
      onSubmit={onSubmit}
    >
      <div className="w-full">
        {/* scroll-margin on the shell, not the overflow:auto editor. Chromium
            uses editor scroll-margin during mouse selection and jumps long drafts. */}
        <div
          className="border-border overflow-hidden rounded-xl border bg-background"
          data-room-composer-mention-anchor
          style={{ scrollMarginTop: MENTION_ANCHOR_SCROLL_MARGIN_TOP_PX }}
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
            <div className="flex shrink-0 items-center gap-2">
              {toolbarEnd}
              {submitControl ?? (
                <RoomComposerSendButton
                  sendBlocked={sendBlocked}
                  isSending={isSending}
                  ariaLabel={sendAriaLabel}
                  testId={sendButtonTestId}
                  onPrepareSubmit={onPrepareSubmit}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

interface RoomComposerSendButtonProps {
  sendBlocked: boolean;
  isSending: boolean;
  ariaLabel: string;
  testId?: string;
  onPrepareSubmit?: () => void;
}

/**
 * Send control, mounted only when the composer has no `submitControl` of its
 * own. Owns every guard that keeps the editor focused through the tap, so the
 * touchstart listener lives and dies with the button it belongs to.
 */
function RoomComposerSendButton({
  sendBlocked,
  isSending,
  ariaLabel,
  testId,
  onPrepareSubmit,
}: RoomComposerSendButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const lastPointerSubmitAtRef = useRef(Number.NEGATIVE_INFINITY);
  // Handlers read these through refs: the listener below is bound once on
  // mount, so it must not close over a stale render's values.
  const sendBlockedRef = useRef(sendBlocked);
  sendBlockedRef.current = sendBlocked;
  const onPrepareSubmitRef = useRef(onPrepareSubmit);
  onPrepareSubmitRef.current = onPrepareSubmit;

  function requestComposerSubmit(form: HTMLFormElement | null) {
    if (!form || sendBlockedRef.current) return;
    onPrepareSubmitRef.current?.();
    form.requestSubmit();
  }

  // iOS moves focus off the editor on the touch itself, and preventDefault on
  // pointerdown does not stop it: the editor blurs a beat after Send and the
  // keyboard slides away. Only touchstart holds it (checked on iOS 27 WebKit:
  // pointerdown alone blurs and the visual viewport grows back, touchstart
  // alone keeps both). React registers `onTouchStart` passively, where
  // preventDefault is a silent no-op, so this has to be a native listener.
  useMountEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const keepEditorFocus = (event: globalThis.TouchEvent) => {
      event.preventDefault();
    };
    button.addEventListener("touchstart", keepEditorFocus, { passive: false });
    return () => {
      button.removeEventListener("touchstart", keepEditorFocus);
    };
  });

  function handleSendPointerDown(event: PointerEvent<HTMLButtonElement>) {
    // Covers pointer/mouse; touchstart above is what holds focus on iOS.
    if (event.button !== 0) return;
    event.preventDefault();
    if (sendBlocked) return;
    lastPointerSubmitAtRef.current = performance.now();
    requestComposerSubmit(event.currentTarget.form);
  }

  function handleSendClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    // Same-gesture leftover click after pointerdown already submitted.
    // A later click-only first tap (pointerdown missed Send) must still submit.
    const sincePointerSubmit =
      performance.now() - lastPointerSubmitAtRef.current;
    if (
      event.detail > 0 &&
      sincePointerSubmit < POINTER_SUBMIT_CLICK_GUARD_MS
    ) {
      return;
    }
    requestComposerSubmit(event.currentTarget.form);
  }

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="primary"
      size="icon"
      className={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
      disabled={sendBlocked}
      aria-label={ariaLabel}
      data-testid={testId}
      onPointerDown={handleSendPointerDown}
      onClick={handleSendClick}
    >
      {isSending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <ArrowUp className="size-4" aria-hidden />
      )}
    </Button>
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
      onPick={(emoji) => {
        recordEmojiUse(emoji);
        onPick(emoji);
      }}
      title={title}
      ariaLabel={ariaLabel}
      align="start"
      triggerClassName={ROOM_COMPOSER_TOOL_BUTTON_CLASSNAME}
    />
  );
}

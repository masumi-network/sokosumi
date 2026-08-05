"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  Pencil,
  Quote,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useClientLocalCalendarReady } from "@/app/chat/hooks/use-client-local-calendar-ready";
import {
  getJumboEmojiCount,
  jumboEmojiClassName,
} from "@/app/chat/utils/jumbo-emoji";
import {
  type RoomMessageFilesSegment,
  segmentRoomMessageContent,
} from "@/app/chat/utils/room-message-segments";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import Markdown from "@/components/markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { FileChipMiniPreviewFrame } from "@/components/ui/file-chip-mini-preview";
import { FileTypeIcon } from "@/components/ui/file-icon";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomMessageQuote,
  ChatRoomMessageQuoteAttachment,
  ChatRoomMessageReaction,
  ChatRoomMessageUnfurl,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import { getInitials } from "@/lib/utils/text";
import { ChatParticipantHoverCard } from "./chat-participant-hover-card";
import { participantDirectKey } from "./open-direct-with-participant";
import { AiCoworkerIcon } from "./room-draft-shared";
import {
  type ChatParticipantHoverProfile,
  formatMessageTime,
  formatRoomMarkdownMentions,
  messageSender,
  scrollToRoomMessageElement,
} from "./room-helpers";

type UserMentionLookup = Pick<ChatRoomUserParticipant, "id" | "name">;
type RoomMessageQuoteSnapshot = Exclude<ChatRoomMessageQuote, null>;
type RoomQuoteAttachment = Exclude<ChatRoomMessageQuoteAttachment, null>;

/** Collapsed preview height for primary message bodies (taller than quotes). */
const MESSAGE_BODY_CLAMP_CLASS = "line-clamp-[16]";

/**
 * Local wall-clock time for a message. Empty until mount so SSR (Node locale/TZ)
 * matches hydrate; then fills with `formatMessageTime` (SOKOSUMI-A).
 */
function MessageWallClockTime({
  value,
  className,
  title,
}: {
  value: Date | string;
  className?: string;
  title?: string;
}) {
  const localCalendarReady = useClientLocalCalendarReady();
  const dateTime = new Date(value).toISOString();
  const label = localCalendarReady ? formatMessageTime(value) : null;

  return (
    <time
      dateTime={dateTime}
      className={className}
      title={title ?? label ?? undefined}
    >
      {label}
    </time>
  );
}

function isLargeSoloImageFilesSegment(
  segment: RoomMessageFilesSegment,
): boolean {
  if (segment.links.length !== 1) {
    return false;
  }
  const soloLink = segment.links[0];
  return classifyFilePreview(soloLink.url, soloLink.fileName).isImage;
}

function hasLargeSoloImageAttachment(content: string): boolean {
  return segmentRoomMessageContent(content).some(
    (segment) =>
      segment.kind === "files" && isLargeSoloImageFilesSegment(segment),
  );
}

function useClampedOverflow(resetKey: string) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    setExpanded(false);
  }, [resetKey]);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node || expanded) {
      return;
    }

    function measureOverflow() {
      const el = contentRef.current;
      if (!el) {
        return;
      }
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    }

    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, resetKey]);

  return { expanded, setExpanded, overflows, contentRef };
}

function MessageQuoteAttachmentThumb({
  attachment,
}: {
  attachment: RoomQuoteAttachment;
}) {
  const thumbClassName =
    "bg-accent/30 mt-1 size-10 shrink-0 overflow-hidden rounded-xl border";

  switch (attachment.mediaKind) {
    case "image":
      return (
        <div className={thumbClassName} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachment.url}
            alt=""
            className="size-full object-cover object-center"
          />
        </div>
      );
    case "file": {
      const extension =
        getExtensionFromUrl(attachment.fileName) ||
        getExtensionFromUrl(attachment.url) ||
        "file";
      return (
        <div className={thumbClassName} aria-hidden>
          <div className="text-muted-foreground flex size-full items-center justify-center">
            <div className="flex size-6 items-center justify-center">
              <FileTypeIcon extension={extension} />
            </div>
          </div>
        </div>
      );
    }
    default: {
      const _exhaustive: never = attachment.mediaKind;
      return _exhaustive;
    }
  }
}

function formatWhoReactedLabel(
  reaction: ChatRoomMessageReaction,
  t: ReturnType<typeof useTranslations>,
): string | null {
  const names = reaction.reactors.map((reactor) => reactor.name).join(", ");
  const more = Math.max(0, reaction.count - reaction.reactors.length);

  if (!names) {
    if (more === 0) {
      return null;
    }
    return t("Reactions.andMore", { count: more });
  }

  return t("Reactions.whoReacted", { names, more });
}

function MessageQuoteBlock({
  quote,
  coworkersById,
  coworkersBySlug,
  usersById,
  usersBySlug,
}: {
  quote: RoomMessageQuoteSnapshot;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
}) {
  const t = useTranslations("App.Channels.Quote");
  const { expanded, setExpanded, overflows, contentRef } = useClampedOverflow(
    `${quote.messageId}\0${quote.snippet}`,
  );

  const attachment = quote.attachment ?? null;

  return (
    <div className="border-border bg-muted/40 mb-1.5 w-full rounded-md border-l-2 border-l-primary/60 px-2.5 py-1.5">
      <button
        type="button"
        className="hover:bg-muted/70 focus-visible:ring-ring -mx-1 w-[calc(100%+0.5rem)] rounded-sm px-1 text-left outline-none transition-colors focus-visible:ring-2"
        aria-label={t("jump", { author: quote.authorName })}
        onClick={() => {
          scrollToRoomMessageElement(quote.messageId);
        }}
      >
        <div className="text-foreground truncate text-xs font-semibold">
          {quote.authorName}
        </div>
        {quote.snippet.trim() ? (
          <div
            ref={contentRef}
            className={cn(
              "text-muted-foreground text-xs leading-5",
              expanded ? null : "line-clamp-4",
            )}
          >
            <Markdown className="prose-p:my-0 prose-p:leading-5 prose-ul:my-0 prose-ol:my-0 prose-pre:my-0">
              {formatRoomMarkdownMentions({
                content: quote.snippet,
                coworkersById,
                coworkersBySlug,
                usersById,
                usersBySlug,
              })}
            </Markdown>
          </div>
        ) : null}
        {attachment ? (
          <MessageQuoteAttachmentThumb attachment={attachment} />
        ) : null}
      </button>
      {expanded || overflows ? (
        <button
          type="button"
          className="text-primary hover:text-primary/80 mt-0.5 text-xs font-medium outline-none focus-visible:underline"
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          {expanded ? t("showLess") : t("showMore")}
        </button>
      ) : null}
    </div>
  );
}

function MessageUnfurlImage({
  imageUrl,
  title,
}: {
  imageUrl: string;
  title: string;
}) {
  const t = useTranslations("App.Channels.Unfurl");
  const [failed, setFailed] = useState(false);

  if (failed) {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={t("imageAlt", { title })}
      className="mt-2 h-auto max-h-48 max-w-full rounded-md"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

function MessageUnfurlCard({ unfurl }: { unfurl: ChatRoomMessageUnfurl }) {
  const t = useTranslations("App.Channels.Unfurl");
  const siteLabel = unfurl.siteName?.trim() || null;

  return (
    <a
      href={unfurl.url}
      target="_blank"
      rel="noopener noreferrer"
      className="border-border bg-muted/40 hover:bg-muted/60 focus-visible:ring-ring mt-1.5 inline-block w-fit max-w-full overflow-hidden rounded-md border-l-2 border-l-primary/60 px-2.5 py-2 outline-none transition-colors focus-visible:ring-2"
      aria-label={t("openLink", { title: unfurl.title })}
      data-testid="room-message-unfurl"
    >
      {siteLabel ? (
        <div className="text-muted-foreground truncate text-[11px] font-medium tracking-wide uppercase">
          {siteLabel}
        </div>
      ) : null}
      <div className="text-foreground line-clamp-2 text-sm font-semibold leading-5">
        {unfurl.title}
      </div>
      {unfurl.description?.trim() ? (
        <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-5">
          {unfurl.description}
        </div>
      ) : null}
      {unfurl.imageUrl ? (
        <MessageUnfurlImage imageUrl={unfurl.imageUrl} title={unfurl.title} />
      ) : null}
    </a>
  );
}

function MessageUnfurlList({
  unfurls,
}: {
  unfurls: ChatRoomMessageUnfurl[] | null;
}) {
  if (!unfurls || unfurls.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1" data-testid="room-message-unfurls">
      {unfurls.map((unfurl) => (
        <MessageUnfurlCard key={unfurl.url} unfurl={unfurl} />
      ))}
    </div>
  );
}

function ChannelMarkdownSegment({
  content,
  coworkersById,
  coworkersBySlug,
  usersById,
  usersBySlug,
}: {
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
}) {
  if (!content.trim()) {
    return null;
  }

  return (
    <Markdown className="text-base! md:text-sm! prose-p:my-0 prose-p:leading-6 prose-ul:my-1 prose-ol:my-1 prose-pre:my-2">
      {formatRoomMarkdownMentions({
        content,
        coworkersById,
        coworkersBySlug,
        usersById,
        usersBySlug,
      })}
    </Markdown>
  );
}

function ChannelMessageText({
  content,
  coworkersById,
  coworkersBySlug,
  usersById,
  usersBySlug,
}: {
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
}) {
  const segments = segmentRoomMessageContent(content);

  if (segments.length === 1 && segments[0].kind === "text") {
    return (
      <ChannelMarkdownSegment
        content={segments[0].content}
        coworkersById={coworkersById}
        coworkersBySlug={coworkersBySlug}
        usersById={usersById}
        usersBySlug={usersBySlug}
      />
    );
  }

  return (
    <>
      {segments.map((segment, i) => {
        switch (segment.kind) {
          case "text":
            return (
              <ChannelMarkdownSegment
                key={`text-${i}-${segment.start}`}
                content={segment.content}
                coworkersById={coworkersById}
                coworkersBySlug={coworkersBySlug}
                usersById={usersById}
                usersBySlug={usersBySlug}
              />
            );
          case "files": {
            const useLargeImage = isLargeSoloImageFilesSegment(segment);
            const headLink = segment.links[0];

            return (
              <div
                key={`files-${i}-${headLink.index}`}
                className="my-2 flex min-w-0 max-w-full flex-wrap gap-2"
                data-testid="room-message-attachment-row"
              >
                {segment.links.map((link) => (
                  <FileChipMiniPreviewFrame
                    key={`${link.index}-${link.url}`}
                    url={link.url}
                    fileName={link.fileName}
                    variant={useLargeImage ? "large" : "thumb"}
                    sizeClass={useLargeImage ? undefined : "size-16"}
                  />
                ))}
              </div>
            );
          }
          default: {
            const _exhaustive: never = segment;
            return _exhaustive;
          }
        }
      })}
    </>
  );
}

function ChannelMessageBody({
  messageId,
  content,
  coworkersById,
  coworkersBySlug,
  usersById,
  usersBySlug,
}: {
  messageId: string;
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
}) {
  const t = useTranslations("App.Channels.Message");
  const jumboEmojiCount = getJumboEmojiCount(content);
  const isJumboEmoji = jumboEmojiCount !== null;
  const skipBodyClamp = hasLargeSoloImageAttachment(content);
  const { expanded, setExpanded, overflows, contentRef } = useClampedOverflow(
    `${messageId}\0${content}`,
  );

  // Skip Markdown/prose for jumbo — prose-sm would crush the large font size.
  if (isJumboEmoji) {
    return (
      <div
        data-testid="room-message-body"
        data-jumbo-emoji={String(jumboEmojiCount)}
        className={cn(
          "min-w-0 max-w-full wrap-anywhere [word-break:break-word] whitespace-pre-wrap",
          jumboEmojiClassName(jumboEmojiCount),
        )}
      >
        {content.trim()}
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full wrap-anywhere [word-break:break-word]">
      <div
        ref={contentRef}
        data-testid="room-message-body"
        className={cn(
          "min-w-0 max-w-full",
          expanded || skipBodyClamp ? null : MESSAGE_BODY_CLAMP_CLASS,
        )}
      >
        <ChannelMessageText
          content={content}
          coworkersById={coworkersById}
          coworkersBySlug={coworkersBySlug}
          usersById={usersById}
          usersBySlug={usersBySlug}
        />
      </div>
      {!skipBodyClamp && (expanded || overflows) ? (
        <button
          type="button"
          className="text-primary hover:text-primary/80 mt-1 text-xs font-medium outline-none focus-visible:underline"
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          {expanded ? t("showLess") : t("showMore")}
        </button>
      ) : null}
    </div>
  );
}

const QUICK_MESSAGE_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"] as const;
const LONG_PRESS_DELAY_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE_PX = 12;
const TOUCH_MESSAGE_SELECT_NONE_CLASS =
  "[@media(hover:none)]:select-none [@media(hover:none)]:[-webkit-touch-callout:none]";

function devicePrefersHover(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return window.matchMedia("(hover: hover)").matches;
}

function clearDomTextSelection() {
  window.getSelection()?.removeAllRanges();
}

function useLongPress(onLongPress: () => void): {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }

  return {
    onPointerDown(event) {
      if (event.button !== 0) {
        return;
      }
      if (devicePrefersHover()) {
        return;
      }
      clearTimer();
      startRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        startRef.current = null;
        clearDomTextSelection();
        onLongPress();
      }, LONG_PRESS_DELAY_MS);
    },
    onPointerMove(event) {
      if (!startRef.current || timerRef.current === null) {
        return;
      }
      const deltaX = event.clientX - startRef.current.x;
      const deltaY = event.clientY - startRef.current.y;
      if (
        deltaX * deltaX + deltaY * deltaY >
        LONG_PRESS_MOVE_TOLERANCE_PX * LONG_PRESS_MOVE_TOLERANCE_PX
      ) {
        clearTimer();
      }
    },
    onPointerUp() {
      clearTimer();
    },
    onPointerCancel() {
      clearTimer();
    },
    onContextMenu(event) {
      if (!devicePrefersHover()) {
        event.preventDefault();
      }
    },
  };
}

function MessageActionControls({
  message,
  onToggleReaction,
  onOpenThread,
  onQuote,
  onEdit,
  onDelete,
  showThreadButton,
  showQuoteButton,
  showEditButton,
  showDeleteButton,
  onAfterAction,
}: {
  message: ChatRoomMessage;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  onEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
  showQuoteButton: boolean;
  showEditButton: boolean;
  showDeleteButton: boolean;
  onAfterAction?: () => void;
}) {
  const t = useTranslations("App.Channels");

  return (
    <>
      <EmojiPicker
        title={t("Reactions.add")}
        ariaLabel={t("Reactions.add")}
        align="end"
        triggerClassName="size-9 rounded-full sm:size-7"
        onPick={(emoji) => {
          onToggleReaction(message, emoji);
          onAfterAction?.();
        }}
      />
      {showEditButton && onEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-full sm:size-7"
          title={t("Edit.action")}
          aria-label={t("Edit.action")}
          onClick={() => {
            onEdit(message);
            onAfterAction?.();
          }}
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : null}
      {showQuoteButton && onQuote ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-full sm:size-7"
          title={t("Quote.action")}
          aria-label={t("Quote.action")}
          onClick={() => {
            onQuote(message);
            onAfterAction?.();
          }}
        >
          <Quote className="size-4" aria-hidden />
        </Button>
      ) : null}
      {showThreadButton && onOpenThread ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-full sm:size-7"
          title={t("Thread.open")}
          aria-label={t("Thread.open")}
          onClick={() => {
            onOpenThread(message);
            onAfterAction?.();
          }}
        >
          <MessageCircle className="size-4" aria-hidden />
        </Button>
      ) : null}
      {showDeleteButton && onDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive size-9 rounded-full sm:size-7"
          title={t("Message.delete")}
          aria-label={t("Message.delete")}
          onClick={() => {
            onDelete(message);
            onAfterAction?.();
          }}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      ) : null}
    </>
  );
}

const messageActionsPillClassName =
  "border-border bg-background absolute top-1.5 right-2 flex items-center gap-0.5 rounded-full border p-0.5 shadow-sm";

function MessageActions({
  message,
  onToggleReaction,
  onOpenThread,
  onQuote,
  onEdit,
  onDelete,
  showThreadButton,
  showQuoteButton,
  showEditButton,
  showDeleteButton,
}: {
  message: ChatRoomMessage;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  onEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
  showQuoteButton: boolean;
  showEditButton: boolean;
  showDeleteButton: boolean;
}) {
  return (
    <div
      data-message-actions="hover"
      className={cn(
        messageActionsPillClassName,
        "hidden transition-opacity focus-within:opacity-100 [@media(hover:hover)]:flex [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
      )}
    >
      <MessageActionControls
        message={message}
        onToggleReaction={onToggleReaction}
        onOpenThread={onOpenThread}
        onQuote={onQuote}
        onEdit={onEdit}
        onDelete={onDelete}
        showThreadButton={showThreadButton}
        showQuoteButton={showQuoteButton}
        showEditButton={showEditButton}
        showDeleteButton={showDeleteButton}
      />
    </div>
  );
}

const SHEET_SWIPE_DISMISS_PX = 80;
const SHEET_SWIPE_DRAG_START_PX = 8;

function isSheetSwipeInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, a, input, textarea, [role='button'], [data-slot='popover-content']",
    ),
  );
}

function useBottomSheetSwipeDismiss(
  open: boolean,
  onDismiss: () => void,
): {
  contentRef: RefObject<HTMLDivElement | null>;
  swipeHandlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  };
} {
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number | null;
    startY: number;
    dragging: boolean;
    dismissing: boolean;
  }>({
    pointerId: null,
    startY: 0,
    dragging: false,
    dismissing: false,
  });

  const resetTransform = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transform = "";
    el.style.transition = "";
  }, []);

  useEffect(() => {
    if (!open) {
      dragRef.current = {
        pointerId: null,
        startY: 0,
        dragging: false,
        dismissing: false,
      };
      resetTransform();
    }
  }, [open, resetTransform]);

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId || drag.dismissing) return;

    const dy = Math.max(0, event.clientY - drag.startY);
    drag.pointerId = null;
    const el = contentRef.current;
    if (!el) return;

    if (drag.dragging && dy >= SHEET_SWIPE_DISMISS_PX) {
      drag.dismissing = true;
      el.style.transition = "transform 180ms ease-out";
      el.style.transform = "translateY(100%)";
      window.setTimeout(() => {
        onDismiss();
        resetTransform();
        drag.dismissing = false;
        drag.dragging = false;
      }, 180);
      return;
    }

    el.style.transition = "transform 200ms ease-out";
    el.style.transform = "translateY(0)";
    window.setTimeout(() => {
      if (!drag.dismissing) resetTransform();
    }, 200);
    drag.dragging = false;
  }

  return {
    contentRef,
    swipeHandlers: {
      onPointerDown(event) {
        if (event.button !== 0) return;
        if (dragRef.current.dismissing) return;
        const fromHandle = Boolean(
          event.target instanceof Element &&
            event.target.closest("[data-sheet-swipe-handle]"),
        );
        if (!fromHandle && isSheetSwipeInteractiveTarget(event.target)) return;

        dragRef.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          dragging: false,
          dismissing: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event) {
        const drag = dragRef.current;
        if (drag.pointerId !== event.pointerId || drag.dismissing) return;

        const dy = Math.max(0, event.clientY - drag.startY);
        if (dy > SHEET_SWIPE_DRAG_START_PX) drag.dragging = true;
        if (!drag.dragging) return;

        const el = contentRef.current;
        if (!el) return;
        el.style.transition = "none";
        el.style.transform = `translateY(${dy}px)`;
      },
      onPointerUp: finishPointer,
      onPointerCancel: finishPointer,
    },
  };
}

function TouchMessageActionsSheet({
  open,
  onOpenChange,
  message,
  onToggleReaction,
  onOpenThread,
  onQuote,
  onEdit,
  onDelete,
  showThreadButton,
  showQuoteButton,
  showEditButton,
  showDeleteButton,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: ChatRoomMessage;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  onEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
  showQuoteButton: boolean;
  showEditButton: boolean;
  showDeleteButton: boolean;
}) {
  const t = useTranslations("App.Channels");
  const { contentRef, swipeHandlers } = useBottomSheetSwipeDismiss(open, () => {
    onOpenChange(false);
  });
  const whoReactedRows = message.reactions.flatMap((reaction) => {
    const whoReactedLabel = formatWhoReactedLabel(reaction, t);
    if (!whoReactedLabel) {
      return [];
    }
    return [{ emoji: reaction.emoji, whoReactedLabel }];
  });

  function runAndClose(action: () => void) {
    action();
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={contentRef}
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-t-2xl touch-none pb-[max(1rem,env(safe-area-inset-bottom))]"
        {...swipeHandlers}
      >
        <SheetHeader className="items-center gap-2 pt-1 pb-2">
          <div
            data-sheet-swipe-handle
            className="flex w-full cursor-grab justify-center py-3 active:cursor-grabbing"
          >
            <div
              className="bg-muted-foreground/40 h-1.5 w-12 shrink-0 rounded-full"
              aria-hidden
            />
          </div>
          <SheetTitle>{t("Actions.more")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("Actions.more")}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap items-center justify-center gap-2 px-4 pb-4">
          {QUICK_MESSAGE_REACTIONS.map((emoji) => (
            <Button
              key={emoji}
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 rounded-full text-xl"
              aria-label={t("Reactions.toggle", { emoji })}
              onClick={() => {
                runAndClose(() => {
                  onToggleReaction(message, emoji);
                });
              }}
            >
              <span aria-hidden>{emoji}</span>
            </Button>
          ))}
          <EmojiPicker
            title={t("Reactions.add")}
            ariaLabel={t("Reactions.add")}
            align="center"
            triggerClassName="size-11 rounded-full"
            onPick={(emoji) => {
              runAndClose(() => {
                onToggleReaction(message, emoji);
              });
            }}
          />
        </div>
        {whoReactedRows.length > 0 ? (
          <ul
            aria-label={t("Reactions.whoReactedList")}
            className="border-border space-y-2 border-t px-4 py-3"
          >
            {whoReactedRows.map((row) => (
              <li key={row.emoji} className="flex items-start gap-2 text-sm">
                <span className="text-base leading-none" aria-hidden>
                  {row.emoji}
                </span>
                <span className="text-muted-foreground min-w-0 flex-1">
                  {row.whoReactedLabel}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="border-border flex flex-col gap-1 border-t px-2 py-2">
          {showEditButton && onEdit ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 justify-start gap-3 px-3"
              onClick={() => {
                runAndClose(() => {
                  onEdit(message);
                });
              }}
            >
              <Pencil className="size-4 shrink-0" aria-hidden />
              {t("Edit.action")}
            </Button>
          ) : null}
          {showQuoteButton && onQuote ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 justify-start gap-3 px-3"
              onClick={() => {
                runAndClose(() => {
                  onQuote(message);
                });
              }}
            >
              <Quote className="size-4 shrink-0" aria-hidden />
              {t("Quote.action")}
            </Button>
          ) : null}
          {showThreadButton && onOpenThread ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 justify-start gap-3 px-3"
              onClick={() => {
                runAndClose(() => {
                  onOpenThread(message);
                });
              }}
            >
              <MessageCircle className="size-4 shrink-0" aria-hidden />
              {t("Thread.open")}
            </Button>
          ) : null}
          {showDeleteButton && onDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive h-11 justify-start gap-3 px-3"
              onClick={() => {
                runAndClose(() => {
                  onDelete(message);
                });
              }}
            >
              <Trash2 className="size-4 shrink-0" aria-hidden />
              {t("Message.delete")}
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MessageEditComposer({
  value,
  originalContent,
  onChange,
  onSave,
  onCancel,
  isSaving,
}: {
  value: string;
  originalContent: string;
  onChange: (value: string) => void;
  onSave: (content: string) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const t = useTranslations("App.Channels");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // autoFocus leaves the caret at 0; place it at the end so editing continues
  // from the natural end of the message (Slack/Discord-style).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // Live DOM via currentTarget: parent draft can lag the last keystroke's
  // onChange. Enter with no real change (or empty) exits edit mode — no-op
  // after preventDefault felt like a broken keyboard.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (!isSaving) onCancel();
      return;
    }

    if (event.key !== "Enter") return;
    // Shift+Enter → newline (default)
    if (event.shiftKey) return;
    // Alt+Enter ignored (leave default / no save)
    if (event.altKey) return;

    event.preventDefault();
    if (isSaving) return;

    const live = event.currentTarget.value;
    const liveTrimmed = live.trim();
    const originalTrimmed = originalContent.trim();
    if (liveTrimmed.length > 0 && liveTrimmed !== originalTrimmed) {
      onSave(live);
      return;
    }
    onCancel();
  }

  return (
    <div className="pt-0.5">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        disabled={isSaving}
        className="min-h-10 max-h-40 resize-none overflow-y-auto field-sizing-content px-3 py-2.5 leading-6"
        aria-label={t("Edit.composerAria")}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (isSaving) return;
          // Live DOM (same race as Enter): prop can lag a just-typed character.
          const live = textareaRef.current?.value ?? value;
          if (live.trim() === originalContent.trim()) {
            onCancel();
          }
        }}
      />
    </div>
  );
}

function MessageMetaFooter({
  message,
  coworkersById,
  onToggleReaction,
  onOpenThread,
  showThreadButton,
  isDeleted,
}: {
  message: ChatRoomMessage;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
  isDeleted: boolean;
}) {
  const t = useTranslations("App.Channels");

  return (
    <>
      {!isDeleted && message.reactions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {message.reactions.map((reaction) => {
            const whoReactedLabel = formatWhoReactedLabel(reaction, t);

            return (
              <Tooltip key={reaction.emoji}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onToggleReaction(message, reaction.emoji)}
                    className={cn(
                      "border-border bg-background hover:bg-muted inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors sm:h-7 sm:px-2",
                      reaction.reactedByCurrentUser &&
                        "border-primary/30 bg-primary/10 text-primary",
                    )}
                    aria-label={t("Reactions.toggle", {
                      emoji: reaction.emoji,
                    })}
                  >
                    <span className="text-sm leading-none">
                      {reaction.emoji}
                    </span>
                    <span>{reaction.count}</span>
                  </button>
                </TooltipTrigger>
                {whoReactedLabel ? (
                  <TooltipContent side="top" sideOffset={6}>
                    {whoReactedLabel}
                  </TooltipContent>
                ) : null}
              </Tooltip>
            );
          })}
        </div>
      ) : null}
      {showThreadButton && message.threadReplyCount > 0 && onOpenThread ? (
        <button
          type="button"
          className="text-primary hover:text-primary/80 -mx-1 mt-1 min-h-9 px-1 text-xs font-medium sm:mt-1 sm:min-h-0"
          onClick={() => onOpenThread(message)}
        >
          {t("Thread.replyCount", { count: message.threadReplyCount })}
        </button>
      ) : null}
      {!isDeleted && message.mentions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1.5">
          {message.mentions.map((mention) => {
            const name =
              coworkersById.get(mention.coworkerId)?.name ??
              t("MentionStatus.nameFallback");
            return (
              <Badge
                key={mention.id}
                variant={
                  mention.status === "failed" ? "destructive" : "outline"
                }
              >
                {mention.status === "responded" ? (
                  <CheckCircle2 className="size-3" />
                ) : mention.status === "failed" ? null : (
                  <Loader2 className="size-3 animate-spin" />
                )}
                {t(`MentionStatus.${mention.status}`, { name })}
              </Badge>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

export function ChatMessageRow({
  message,
  coworkersById,
  coworkersBySlug,
  usersById,
  usersBySlug,
  currentUserId,
  canOpenHumanDirect = false,
  onOpenDirectMessage,
  openingDirectParticipantKey = null,
  onToggleReaction,
  onOpenThread,
  onQuote,
  onStartEdit,
  onDelete,
  isEditing = false,
  editDraft = "",
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  isSavingEdit = false,
  showThreadButton = true,
  showQuoteButton = true,
  isContinuation = false,
  isFirstOfDay = false,
}: {
  message: ChatRoomMessage;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  onStartEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  isEditing?: boolean;
  editDraft?: string;
  onEditDraftChange?: (value: string) => void;
  onCancelEdit?: () => void;
  /** Optional content uses the live editor value (avoids stale draft on Enter). */
  onSaveEdit?: (content?: string) => void;
  isSavingEdit?: boolean;
  showThreadButton?: boolean;
  showQuoteButton?: boolean;
  /** Slack-style continuation: omit avatar / name / primary timestamp. */
  isContinuation?: boolean;
  /** First message of a calendar day after a day separator; omit top margin because separator already provides rhythm. */
  isFirstOfDay?: boolean;
}) {
  const tChat = useTranslations("App.Chat.Chat");
  const tChannels = useTranslations("App.Channels");
  const sender = messageSender(message);
  const hoverProfile = sender.kind === "unknown" ? null : sender;
  const isOpeningDirect = hoverProfile
    ? openingDirectParticipantKey === participantDirectKey(hoverProfile)
    : false;
  const isDirectActionBusy = openingDirectParticipantKey != null;
  const isStreamOverlay = message.id.startsWith("stream:");
  const isDeleted = message.deletedAt != null;
  const isThinking =
    isStreamOverlay &&
    message.sender.type === "coworker" &&
    message.content.trim().length === 0;
  const canQuote =
    showQuoteButton && Boolean(onQuote) && !isStreamOverlay && !isDeleted;
  const canEdit =
    Boolean(onStartEdit) &&
    Boolean(currentUserId) &&
    message.sender.type === "user" &&
    message.sender.user.id === currentUserId &&
    !isStreamOverlay &&
    !isDeleted;
  const canDelete =
    Boolean(onDelete) &&
    Boolean(currentUserId) &&
    !isDeleted &&
    !isStreamOverlay &&
    message.sender.type === "user" &&
    message.sender.user.id === currentUserId;
  const showEdited = !isDeleted && message.editedAt != null;
  const quote = message.quote;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const longPress = useLongPress(() => {
    setSheetOpen(true);
  });
  const showActions = !isThinking && !isDeleted && !isEditing;

  function requestDelete(_message: ChatRoomMessage) {
    setSheetOpen(false);
    setDeleteDialogOpen(true);
  }

  function confirmDelete() {
    onDelete?.(message);
    setDeleteDialogOpen(false);
  }

  return (
    <article
      id={`message-${message.id}`}
      data-message-id={message.id}
      aria-label={isContinuation ? sender.name : undefined}
      className={cn(
        "group relative -mx-2 flex min-w-0 max-w-full gap-3.5 overflow-x-clip rounded-md pl-2 transition-colors hover:bg-muted/45 [@media(hover:hover)]:pr-20",
        showActions && TOUCH_MESSAGE_SELECT_NONE_CLASS,
        isContinuation
          ? "min-h-0 py-0.5"
          : isFirstOfDay
            ? "mt-0 min-h-0 pt-1 pb-0.5"
            : "mt-2 min-h-0 pt-1 pb-0.5",
      )}
      {...(showActions ? longPress : {})}
    >
      {isContinuation ? (
        <div className="flex w-8 shrink-0 justify-center pt-0.5">
          <MessageWallClockTime
            value={message.createdAt}
            className="text-muted-foreground whitespace-nowrap text-[10px] leading-4 tabular-nums opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          />
        </div>
      ) : (
        <ChatParticipantHoverCard
          profile={hoverProfile}
          side="top"
          align="start"
          className="mt-0.5 shrink-0"
          currentUserId={currentUserId}
          canOpenHumanDirect={canOpenHumanDirect}
          onOpenDirect={onOpenDirectMessage}
          isOpeningDirect={isOpeningDirect}
          isDirectActionBusy={isDirectActionBusy}
        >
          <Avatar className="size-8">
            <AvatarImage src={sender.image ?? undefined} alt="" />
            <AvatarFallback className="text-xs">
              {getInitials(sender.name)}
            </AvatarFallback>
          </Avatar>
        </ChatParticipantHoverCard>
      )}
      <div
        className={cn(
          "min-w-0 max-w-full flex-1 overflow-x-clip",
          isContinuation ? "space-y-1" : "space-y-1.5",
        )}
      >
        {isContinuation ? null : (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <ChatParticipantHoverCard
              profile={hoverProfile}
              side="top"
              align="start"
              className="w-fit min-w-0 max-w-full"
              currentUserId={currentUserId}
              canOpenHumanDirect={canOpenHumanDirect}
              onOpenDirect={onOpenDirectMessage}
              isOpeningDirect={isOpeningDirect}
              isDirectActionBusy={isDirectActionBusy}
            >
              <span className="truncate text-base font-semibold md:text-sm">
                {sender.name}
              </span>
            </ChatParticipantHoverCard>
            {sender.kind === "coworker" ? <AiCoworkerIcon /> : null}
            <MessageWallClockTime
              value={message.createdAt}
              className="text-muted-foreground text-xs"
            />
            {showEdited ? (
              <span className="text-muted-foreground text-xs">
                {tChannels("Edit.edited")}
              </span>
            ) : null}
          </div>
        )}
        <div className="text-foreground min-w-0 max-w-full wrap-anywhere [word-break:break-word] text-base leading-6 md:text-sm">
          {isDeleted ? (
            <p className="text-muted-foreground italic">
              {tChannels("Message.deleted")}
            </p>
          ) : (
            <>
              {quote ? (
                <MessageQuoteBlock
                  quote={quote}
                  coworkersById={coworkersById}
                  coworkersBySlug={coworkersBySlug}
                  usersById={usersById}
                  usersBySlug={usersBySlug}
                />
              ) : null}
              {isEditing && onEditDraftChange && onCancelEdit && onSaveEdit ? (
                <MessageEditComposer
                  value={editDraft}
                  originalContent={message.content}
                  onChange={onEditDraftChange}
                  onSave={onSaveEdit}
                  onCancel={onCancelEdit}
                  isSaving={isSavingEdit}
                />
              ) : isThinking ? (
                <span
                  className="reasoning-text-shine text-base leading-5 md:text-sm"
                  role="status"
                  aria-live="polite"
                >
                  {tChat("reasoning.thinking")}
                </span>
              ) : (
                <>
                  <ChannelMessageBody
                    messageId={message.id}
                    content={message.content}
                    coworkersById={coworkersById}
                    coworkersBySlug={coworkersBySlug}
                    usersById={usersById}
                    usersBySlug={usersBySlug}
                  />
                  {isContinuation && showEdited ? (
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      {tChannels("Edit.edited")}
                    </span>
                  ) : null}
                  <MessageUnfurlList unfurls={message.unfurls} />
                </>
              )}
            </>
          )}
        </div>
        {!isEditing ? (
          <MessageMetaFooter
            message={message}
            coworkersById={coworkersById}
            onToggleReaction={onToggleReaction}
            onOpenThread={onOpenThread}
            showThreadButton={showThreadButton}
            isDeleted={isDeleted}
          />
        ) : null}
      </div>
      {showActions ? (
        <>
          <MessageActions
            message={message}
            onToggleReaction={onToggleReaction}
            onOpenThread={onOpenThread}
            onQuote={onQuote}
            onEdit={onStartEdit}
            onDelete={requestDelete}
            showThreadButton={showThreadButton}
            showQuoteButton={canQuote}
            showEditButton={canEdit}
            showDeleteButton={canDelete}
          />
          <button
            type="button"
            className="sr-only"
            onClick={() => {
              setSheetOpen(true);
            }}
          >
            {tChannels("Actions.more")}
          </button>
          <TouchMessageActionsSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            message={message}
            onToggleReaction={onToggleReaction}
            onOpenThread={onOpenThread}
            onQuote={onQuote}
            onEdit={onStartEdit}
            onDelete={requestDelete}
            showThreadButton={showThreadButton}
            showQuoteButton={canQuote}
            showEditButton={canEdit}
            showDeleteButton={canDelete}
          />
        </>
      ) : null}
      {canDelete ? (
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tChannels("Message.delete")}</AlertDialogTitle>
              <AlertDialogDescription>
                {tChannels("Message.deleteConfirm")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {tChannels("Actions.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: "destructive" })}
                onClick={confirmDelete}
              >
                {tChannels("Message.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </article>
  );
}

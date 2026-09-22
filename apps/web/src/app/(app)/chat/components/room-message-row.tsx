"use client";

import {
  CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
  type ChannelLinkTarget,
  getExtensionFromUrl,
  unfurlCardHasPreviewContent,
} from "@sokosumi/utils";
import {
  AlertCircle,
  Check,
  Copy,
  Ellipsis,
  Link2,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  Quote,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  CoworkerFailedThoughtSparkle,
  CoworkerLiveThought,
  CoworkerThoughtTrace,
} from "@/app/chat/components/coworker-thought-ui";
import { useClampedOverflow } from "@/app/chat/hooks/use-clamped-overflow";
import { useClientLocalCalendarReady } from "@/app/chat/hooks/use-client-local-calendar-ready";
import {
  extractThoughtStartedAtMs,
  formatThoughtDurationLabel,
  isFailedMentionThoughtShell,
  resolveCoworkerThoughtViewModel,
} from "@/app/chat/utils/coworker-thought";
import {
  getJumboEmojiCount,
  jumboEmojiClassName,
} from "@/app/chat/utils/jumbo-emoji";
import {
  isOutboundLocalMessage,
  OUTBOUND_PENDING_SPINNER_DELAY_MS,
  OUTBOUND_SENT_TICK_MS,
  type OutboundDeliveryStatus,
  outboundPendingAgeMs,
  readClientTurnId,
  readOutboundDeliveryStatus,
  readOutboundErrorMessage,
  shouldShowOutboundPendingSpinner,
} from "@/app/chat/utils/outbound-room-message";
import { isOutboundSentTickActive } from "@/app/chat/utils/outbound-sent-tick";
import { resolveQuickReactions } from "@/app/chat/utils/quick-reactions";
import {
  type RoomMessageFilesSegment,
  segmentRoomMessageContent,
} from "@/app/chat/utils/room-message-segments";
import { AuroraOrb } from "@/components/aurora-orb";
import type { ComposerChannelOption } from "@/components/chat/composer-suggestions";
import {
  ComposerWysiwygEditor,
  type ComposerWysiwygEditorHandle,
} from "@/components/chat/composer-wysiwyg-editor";
import { EmojiPicker } from "@/components/chat/emoji-picker";
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
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileChipMiniPreviewFrame } from "@/components/ui/file-chip-mini-preview";
import { FileTypeIcon } from "@/components/ui/file-icon";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea-utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { copyTextWithToast } from "@/hooks/use-clipboard";
import {
  recordEmojiUse,
  useFrequentlyUsedEmojis,
} from "@/hooks/use-frequently-used-emojis";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { useRememberedImageSize } from "@/hooks/use-remembered-image-size";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomMessageQuote,
  ChatRoomMessageQuoteAttachment,
  ChatRoomMessageReaction,
  ChatRoomMessageUnfurl,
  ChatRoomSokoBotParticipant,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { devicePrefersHover } from "@/lib/utils/device-prefers-hover";
import { getEmojiShortcodeName } from "@/lib/utils/emoji-shortcodes";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";
import { getInitials } from "@/lib/utils/text";
import { ChatParticipantHoverCard } from "./chat-participant-hover-card";
import { participantDirectKey } from "./open-direct-with-participant";
import { AiCoworkerAvatarBadge } from "./room-draft-shared";
import {
  type ChatParticipantHoverProfile,
  composerMentionDisplayNames,
  formatRoomComposerTooLongFailure,
  isRoomComposerContentCountVisible,
  isRoomComposerContentOverLimit,
  messageSender,
  ROOM_MESSAGE_MARKDOWN_CLASSNAME,
  ROOM_QUOTE_MARKDOWN_CLASSNAME,
  type RoomMentionParticipant,
} from "./room-helpers";
import { RoomMessageMarkdown } from "./room-mention-markdown";
import { SokoBotChainBadge } from "./soko-bot-chain-badge";
import { SokoBotMessageFooter } from "./soko-bot-message-footer";

type UserMentionLookup = Pick<ChatRoomUserParticipant, "id" | "name">;
type RoomMessageQuoteSnapshot = Exclude<ChatRoomMessageQuote, null>;
type RoomQuoteAttachment = Exclude<ChatRoomMessageQuoteAttachment, null>;

/** Collapsed preview height for primary message bodies (taller than quotes). */
const MESSAGE_BODY_CLAMP_CLASS = "line-clamp-[16]";

/**
 * Keeps the last line of a body clear of the Seen by faces in the row's
 * bottom-right corner. Inline, so it shortens that one line instead of
 * every line — a phone body column is ~310px, and reserving on the column
 * cost a quarter of it on the newest message in the room.
 *
 * Wide enough for what the corner occupies, which is more than the faces:
 * three plus the `+N` is 52px, and below md the touch target reaches 14px
 * further left again.
 */
const SEEN_BY_INLINE_RESERVE_CLASS = "inline-block h-1 w-[66px] align-baseline";

interface MessageEditedLabelProps {
  editedAt: Date | string;
  className?: string;
}

function MessageEditedLabel({ editedAt, className }: MessageEditedLabelProps) {
  const t = useTranslations("App.Channels");
  const format = useFormatter();
  const localCalendarReady = useClientLocalCalendarReady();
  const when = localCalendarReady
    ? format.dateTime(new Date(editedAt), "dateTimeMedium")
    : null;
  const editedWhen = when ? t("Edit.editedAt", { when }) : undefined;

  return (
    <span
      className={cn("text-muted-foreground text-xs leading-none", className)}
      title={editedWhen}
    >
      <span>{t("Edit.edited")}</span>
      {editedWhen ? <span className="sr-only">{editedWhen}</span> : null}
    </span>
  );
}

interface MessagePinnedLabelProps {
  className?: string;
}

function MessagePinnedLabel({ className }: MessagePinnedLabelProps) {
  const t = useTranslations("App.Channels");

  return (
    <span
      className={cn("text-muted-foreground text-xs leading-none", className)}
    >
      <Pin className="me-1 inline size-3 align-[-0.125em]" aria-hidden />
      {t("PinnedMessages.pinned")}
    </span>
  );
}

/**
 * Wall-clock time for a message in the viewer's zone and hour cycle. Empty
 * until mount, like the day separators it sits under, which bucket by the
 * browser's local calendar (SOKOSUMI-A).
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
  const format = useFormatter();
  const localCalendarReady = useClientLocalCalendarReady();
  const dateTime = new Date(value).toISOString();
  const label = localCalendarReady
    ? format.dateTime(new Date(value), "time")
    : null;

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

function MessageQuoteAttachmentThumb({
  attachment,
}: {
  attachment: RoomQuoteAttachment;
}) {
  const thumbClassName =
    "bg-card-background mt-1 size-10 shrink-0 overflow-hidden rounded-xl border";

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
  messageId,
  roomId,
  quote,
  coworkersById,
  coworkersBySlug,
  sokoBotsById,
  sokoBotsBySlug,
  usersById,
  usersBySlug,
  channelLinks,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirectMessage,
  openingDirectParticipantKey,
  onJumpToQuotedMessage,
}: {
  messageId: string;
  roomId: string;
  quote: RoomMessageQuoteSnapshot;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
  channelLinks: readonly ChannelLinkTarget[];
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
  onJumpToQuotedMessage?: (messageId: string) => void;
}) {
  const t = useTranslations("App.Channels.Quote");
  const router = useRouter();
  const { expanded, toggleExpanded, overflows, contentRef } =
    useClampedOverflow({
      cacheKey: `quote:${messageId}`,
      resetKey: `${quote.messageId}\0${quote.snippet}`,
    });

  const attachment = quote.attachment ?? null;

  return (
    <div className="border-border bg-card-background mb-1.5 w-full rounded-md border-l-2 border-l-primary-tertiary px-2.5 py-1.5">
      <button
        type="button"
        className="hover:bg-senary focus-visible:ring-ring -mx-1 w-[calc(100%+0.5rem)] rounded-sm px-1 text-left outline-none transition-colors focus-visible:ring-2"
        aria-label={t("jump", { author: quote.authorName })}
        onClick={() => {
          // Sent to yourself from another room: this transcript does not hold
          // the original, so follow its Message link instead of scrolling.
          if (quote.roomId && quote.roomId !== roomId) {
            router.push(chatRoomMessageHref(quote.roomId, quote.messageId));
            return;
          }
          onJumpToQuotedMessage?.(quote.messageId);
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
            <RoomMessageMarkdown
              content={quote.snippet}
              markdownClassName={ROOM_QUOTE_MARKDOWN_CLASSNAME}
              coworkersById={coworkersById}
              coworkersBySlug={coworkersBySlug}
              sokoBotsById={sokoBotsById}
              sokoBotsBySlug={sokoBotsBySlug}
              usersById={usersById}
              usersBySlug={usersBySlug}
              channelLinks={channelLinks}
              currentUserId={currentUserId}
              canOpenHumanDirect={canOpenHumanDirect}
              onOpenDirectMessage={onOpenDirectMessage}
              openingDirectParticipantKey={openingDirectParticipantKey}
              hoverInteractive={false}
            />
          </div>
        ) : null}
        {attachment ? (
          <MessageQuoteAttachmentThumb attachment={attachment} />
        ) : null}
      </button>
      {expanded || overflows ? (
        <button
          type="button"
          className="text-primary hover:text-primary-hover mt-0.5 text-xs font-medium outline-none focus-visible:underline"
          onClick={toggleExpanded}
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
  onError,
}: {
  imageUrl: string;
  title: string;
  onError: () => void;
}) {
  const t = useTranslations("App.Channels.Unfurl");
  // Reserves the box on a remount, so a row scrolled back into view does not
  // grow by the image a frame later.
  const { onLoad, ...size } = useRememberedImageSize(imageUrl);
  const [loaded, setLoaded] = useState(size.width != null);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={t("imageAlt", { title })}
      className={cn(
        // Fill the card's text column and crop what does not fit, so the image
        // edge lines up with the title at any aspect ratio. The remembered
        // natural size still supplies the ratio, so a wide preview keeps its
        // own height and only a tall one is cropped.
        "mt-2 w-full rounded-md object-cover",
        // 200px is the smallest cap that leaves the standard 1.91:1 Open Graph
        // card whole in this 378px column (378 / 1.91 = 198), and it matches the
        // Apple budget. Until the first load the box is the cap itself: link
        // previews are wide, so nearly all of them land there, and the row does
        // not grow under a reader scrolling past it.
        loaded ? "h-auto max-h-50" : "h-50",
      )}
      onError={onError}
      onLoad={(event) => {
        onLoad(event);
        setLoaded(true);
      }}
      {...size}
    />
  );
}

function MessageUnfurlCard({
  unfurl,
  canRemove,
  onRemove,
}: {
  unfurl: ChatRoomMessageUnfurl;
  canRemove: boolean;
  onRemove?: (url: string) => void;
}) {
  const t = useTranslations("App.Channels.Unfurl");
  const [imageFailed, setImageFailed] = useState(false);
  const siteLabel = unfurl.siteName?.trim() || null;
  const description = unfurl.description?.trim() || null;
  const imageUrl = unfurl.imageUrl?.trim() || null;
  // A failed image drops to text only; the server already filters
  // title-only cards, and a link whose host blocks hotlinks (X with a
  // login cookie) still deserves its labelled card.
  const showImage = Boolean(imageUrl) && !imageFailed;

  return (
    <div className="group/unfurl relative mt-1.5 inline-block w-fit max-w-[min(100%,25rem)]">
      <a
        href={unfurl.url}
        target="_blank"
        rel="noopener noreferrer"
        className="border-border bg-card-background hover:bg-card-background-hover focus-visible:ring-ring inline-block w-fit max-w-[min(100%,25rem)] overflow-hidden rounded-md border-l-2 border-l-primary-tertiary px-2.5 py-2 outline-none transition-colors focus-visible:ring-2"
        aria-label={t("openLink", { title: unfurl.title })}
        data-testid="room-message-unfurl"
      >
        {siteLabel ? (
          <div className="text-muted-foreground truncate text-[0.6875rem] font-medium tracking-wide uppercase">
            {siteLabel}
          </div>
        ) : null}
        <div className="text-foreground line-clamp-2 text-sm font-semibold leading-5">
          {unfurl.title}
        </div>
        {description ? (
          <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-5">
            {description}
          </div>
        ) : null}
        {showImage && imageUrl ? (
          <MessageUnfurlImage
            imageUrl={imageUrl}
            title={unfurl.title}
            onError={() => {
              setImageFailed(true);
            }}
          />
        ) : null}
      </a>
      {canRemove && onRemove ? (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="border-border absolute top-0 right-0 z-10 size-6 translate-x-1/2 -translate-y-1/2 rounded-full border opacity-100 [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/unfurl:pointer-events-auto [@media(hover:hover)]:group-focus-within/unfurl:opacity-100 [@media(hover:hover)]:group-hover/unfurl:pointer-events-auto [@media(hover:hover)]:group-hover/unfurl:opacity-100"
          aria-label={t("remove", { title: unfurl.title })}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove(unfurl.url);
          }}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

function MessageUnfurlList({
  unfurls,
  canRemove,
  onRemove,
}: {
  unfurls: ChatRoomMessageUnfurl[] | null;
  canRemove: boolean;
  onRemove?: (url: string) => void;
}) {
  const visible = unfurls?.filter(unfurlCardHasPreviewContent) ?? [];
  if (visible.length === 0) {
    return null;
  }

  return (
    <div
      className={cn("space-y-1", canRemove && "pr-3")}
      data-testid="room-message-unfurls"
    >
      {visible.map((unfurl) => (
        <MessageUnfurlCard
          key={`${unfurl.url}:${unfurl.imageUrl ?? ""}`}
          unfurl={unfurl}
          canRemove={canRemove}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function ChannelMarkdownSegment({
  content,
  coworkersById,
  coworkersBySlug,
  sokoBotsById,
  sokoBotsBySlug,
  usersById,
  usersBySlug,
  channelLinks,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirectMessage,
  openingDirectParticipantKey,
}: {
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
  channelLinks: readonly ChannelLinkTarget[];
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
}) {
  return (
    <RoomMessageMarkdown
      content={content}
      markdownClassName={ROOM_MESSAGE_MARKDOWN_CLASSNAME}
      coworkersById={coworkersById}
      coworkersBySlug={coworkersBySlug}
      sokoBotsById={sokoBotsById}
      sokoBotsBySlug={sokoBotsBySlug}
      usersById={usersById}
      usersBySlug={usersBySlug}
      channelLinks={channelLinks}
      currentUserId={currentUserId}
      canOpenHumanDirect={canOpenHumanDirect}
      onOpenDirectMessage={onOpenDirectMessage}
      openingDirectParticipantKey={openingDirectParticipantKey}
    />
  );
}

export function ChannelMessageText({
  content,
  coworkersById,
  coworkersBySlug,
  sokoBotsById,
  sokoBotsBySlug,
  usersById,
  usersBySlug,
  channelLinks,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirectMessage,
  openingDirectParticipantKey,
}: {
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
  channelLinks: readonly ChannelLinkTarget[];
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
}) {
  const segments = segmentRoomMessageContent(content);

  if (segments.length === 1 && segments[0].kind === "text") {
    return (
      <ChannelMarkdownSegment
        content={segments[0].content}
        coworkersById={coworkersById}
        coworkersBySlug={coworkersBySlug}
        sokoBotsById={sokoBotsById}
        sokoBotsBySlug={sokoBotsBySlug}
        usersById={usersById}
        usersBySlug={usersBySlug}
        channelLinks={channelLinks}
        currentUserId={currentUserId}
        canOpenHumanDirect={canOpenHumanDirect}
        onOpenDirectMessage={onOpenDirectMessage}
        openingDirectParticipantKey={openingDirectParticipantKey}
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
                sokoBotsById={sokoBotsById}
                sokoBotsBySlug={sokoBotsBySlug}
                usersById={usersById}
                usersBySlug={usersBySlug}
                channelLinks={channelLinks}
                currentUserId={currentUserId}
                canOpenHumanDirect={canOpenHumanDirect}
                onOpenDirectMessage={onOpenDirectMessage}
                openingDirectParticipantKey={openingDirectParticipantKey}
              />
            );
          case "files": {
            const useLargeImage = isLargeSoloImageFilesSegment(segment);
            const headLink = segment.links[0];

            return (
              <div
                key={`files-${i}-${headLink.index}`}
                className="my-2 flex w-full min-w-0 max-w-full flex-wrap gap-2"
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
  sokoBotsById,
  sokoBotsBySlug,
  usersById,
  usersBySlug,
  channelLinks,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirectMessage,
  openingDirectParticipantKey,
  trailing,
}: {
  messageId: string;
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
  channelLinks: readonly ChannelLinkTarget[];
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
  trailing?: ReactNode;
}) {
  const t = useTranslations("App.Channels.Message");
  const jumboEmojiCount = getJumboEmojiCount(content);
  const isJumboEmoji = jumboEmojiCount !== null;
  const skipBodyClamp = hasLargeSoloImageAttachment(content);
  const { expanded, toggleExpanded, overflows, contentRef } =
    useClampedOverflow({ cacheKey: `body:${messageId}`, resetKey: content });

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
        {trailing}
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
          trailing ? "[&_.prose]:contents [&_p:last-of-type]:inline" : null,
        )}
      >
        <ChannelMessageText
          content={content}
          coworkersById={coworkersById}
          coworkersBySlug={coworkersBySlug}
          sokoBotsById={sokoBotsById}
          sokoBotsBySlug={sokoBotsBySlug}
          usersById={usersById}
          usersBySlug={usersBySlug}
          channelLinks={channelLinks}
          currentUserId={currentUserId}
          canOpenHumanDirect={canOpenHumanDirect}
          onOpenDirectMessage={onOpenDirectMessage}
          openingDirectParticipantKey={openingDirectParticipantKey}
        />
        {trailing}
      </div>
      {!skipBodyClamp && (expanded || overflows) ? (
        <button
          type="button"
          className="text-primary hover:text-primary-hover mt-1 text-xs font-medium outline-none focus-visible:underline"
          onClick={toggleExpanded}
        >
          {expanded ? t("showLess") : t("showMore")}
        </button>
      ) : null}
    </div>
  );
}

const HOVER_QUICK_REACTION_COUNT = 3;
const SHEET_QUICK_REACTION_COUNT = 5;
const LONG_PRESS_DELAY_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE_PX = 12;
const TOUCH_MESSAGE_SELECT_NONE_CLASS =
  "[@media(hover:none)]:select-none [@media(hover:none)]:[-webkit-touch-callout:none]";

function readerReactedEmojis(message: ChatRoomMessage): ReadonlySet<string> {
  return new Set(
    message.reactions
      .filter((reaction) => reaction.reactedByCurrentUser)
      .map((reaction) => reaction.emoji),
  );
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
  quickReactions,
  onToggleReaction,
  onOpenThread,
  onQuote,
  onPin,
  onCopy,
  onCopyLink,
  onSendToSelf,
  onEdit,
  onDelete,
  showThreadButton,
  showQuoteButton,
  showPinButton,
  isPinned,
  showCopyButton,
  showCopyLinkButton,
  showEditButton,
  showDeleteButton,
  collapseSecondary = false,
  onAfterAction,
  onMoreOpenChange,
}: {
  message: ChatRoomMessage;
  quickReactions: readonly string[];
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  onPin?: (message: ChatRoomMessage) => void;
  onCopy?: () => void;
  onCopyLink?: () => void;
  /** Absent when the message cannot be sent to the Self Direct. */
  onSendToSelf?: () => void;
  onEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
  showQuoteButton: boolean;
  showPinButton: boolean;
  isPinned: boolean;
  showCopyButton: boolean;
  showCopyLinkButton: boolean;
  showEditButton: boolean;
  showDeleteButton: boolean;
  collapseSecondary?: boolean;
  onAfterAction?: () => void;
  onMoreOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("App.Channels");
  const showPin = Boolean(showPinButton && onPin);
  const showCopyLink = Boolean(showCopyLinkButton && onCopyLink);
  const showCopy = Boolean(showCopyButton && onCopy);
  const showDelete = Boolean(showDeleteButton && onDelete);
  const showMore =
    collapseSecondary &&
    (showPin ||
      showCopyLink ||
      Boolean(onSendToSelf) ||
      showCopy ||
      showDelete);
  const reactedEmojis = readerReactedEmojis(message);

  return (
    <>
      {quickReactions.map((emoji) => {
        const shortcode = getEmojiShortcodeName(emoji);
        const reacted = reactedEmojis.has(emoji);

        return (
          <Button
            key={emoji}
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "group/quick-reaction size-9 rounded-full text-sm sm:size-7",
              reacted && "bg-primary-quinary hover:bg-primary-quaternary",
            )}
            title={
              shortcode ? `:${shortcode}:` : t("Reactions.toggle", { emoji })
            }
            aria-label={t("Reactions.toggle", { emoji })}
            aria-pressed={reacted}
            onClick={() => {
              onToggleReaction(message, emoji);
              onAfterAction?.();
            }}
          >
            {/* Only the glyph grows, so the hover circle keeps its size. */}
            <span
              aria-hidden
              className="transition-transform duration-100 ease-out motion-safe:group-hover/quick-reaction:scale-115"
            >
              {emoji}
            </span>
          </Button>
        );
      })}
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
      {!collapseSecondary && showPin ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-full sm:size-7"
          title={isPinned ? t("PinnedMessages.unpin") : t("PinnedMessages.pin")}
          aria-label={
            isPinned ? t("PinnedMessages.unpin") : t("PinnedMessages.pin")
          }
          onClick={() => {
            onPin?.(message);
            onAfterAction?.();
          }}
        >
          {isPinned ? (
            <PinOff className="size-4" aria-hidden />
          ) : (
            <Pin className="size-4" aria-hidden />
          )}
        </Button>
      ) : null}
      {!collapseSecondary && showCopy ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-full sm:size-7"
          title={t("Copy.action")}
          aria-label={t("Copy.action")}
          onClick={() => {
            onCopy?.();
            onAfterAction?.();
          }}
        >
          <Copy className="size-4" aria-hidden />
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
      {!collapseSecondary && showDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive size-9 rounded-full sm:size-7"
          title={t("Message.delete")}
          aria-label={t("Message.delete")}
          onClick={() => {
            onDelete?.(message);
            onAfterAction?.();
          }}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      ) : null}
      {showMore ? (
        <DropdownMenu onOpenChange={onMoreOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 rounded-full sm:size-7"
              title={t("Actions.overflow")}
              aria-label={t("Actions.overflow")}
            >
              <Ellipsis className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {showPin ? (
              <DropdownMenuItem
                onSelect={() => {
                  onPin?.(message);
                  onAfterAction?.();
                }}
              >
                {isPinned ? (
                  <PinOff className="size-4" aria-hidden />
                ) : (
                  <Pin className="size-4" aria-hidden />
                )}
                {isPinned ? t("PinnedMessages.unpin") : t("PinnedMessages.pin")}
              </DropdownMenuItem>
            ) : null}
            {showCopyLink ? (
              <DropdownMenuItem
                onSelect={() => {
                  onCopyLink?.();
                  onAfterAction?.();
                }}
              >
                <Link2 className="size-4" aria-hidden />
                {t("Copy.link")}
              </DropdownMenuItem>
            ) : null}
            {onSendToSelf ? (
              <DropdownMenuItem
                onSelect={() => {
                  onSendToSelf();
                  onAfterAction?.();
                }}
              >
                <Send className="size-4" aria-hidden />
                {t("Copy.sendToSelf")}
              </DropdownMenuItem>
            ) : null}
            {showCopy ? (
              <DropdownMenuItem
                onSelect={() => {
                  onCopy?.();
                  onAfterAction?.();
                }}
              >
                <Copy className="size-4" aria-hidden />
                {t("Copy.action")}
              </DropdownMenuItem>
            ) : null}
            {showDelete ? (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  onDelete?.(message);
                  onAfterAction?.();
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                {t("Message.delete")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}

// On the row's top edge, as in Slack and the Apple client: the same spot at
// every row height, instead of hanging below a one-line row.
//
// How far above that edge depends on what the row starts with, because the
// text now runs the full width and the pill covers whatever it sits on.
//
// A row with a name-and-time header has an empty lane waiting for it. The
// header is short and left-aligned, so its right half holds nothing, and the
// pill parked there hides no words at all — it only has to clear the first
// line of the body, which a quarter of its height does.
//
// A continuation has no header to sit on, so it lifts three quarters clear
// and covers the tail of the line above instead — one you have finished
// reading, rather than the first line of the message you are pointing at. The
// quarter left behind is what keeps it attached to its own row.
const MESSAGE_ACTIONS_PILL_CLASS =
  "border-border bg-background absolute top-0 right-2 items-center gap-0.5 rounded-full border p-0.5 shadow-sm";

/** Where the pill rides, by what the row leads with. See the class above. */
function messageActionsPillLiftClass(isContinuation: boolean): string {
  return isContinuation ? "-translate-y-3/4" : "-translate-y-1/4";
}

// Debounce the reveal: scrolling drags a stationary pointer across row after
// row, and an instant pill flashes at each one. The delay only applies while
// the row is hovered, so leaving clears it with no delay and the pill goes
// straight out. pointer-events rides the same transition (discrete, so it
// flips mid-fade) — an invisible pill covering the row above must not take
// clicks during the wait.
const MESSAGE_ACTIONS_PILL_REVEAL_DELAY_CLASS =
  "[@media(hover:hover)]:group-hover:delay-200";

function MessageActions({
  message,
  onToggleReaction,
  onOpenThread,
  onQuote,
  onPin,
  onCopy,
  onCopyLink,
  onSendToSelf,
  onEdit,
  onDelete,
  showThreadButton,
  showQuoteButton,
  showPinButton,
  isPinned,
  showCopyButton,
  showCopyLinkButton,
  showEditButton,
  showDeleteButton,
  isContinuation,
}: {
  message: ChatRoomMessage;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  onPin?: (message: ChatRoomMessage) => void;
  onCopy?: () => void;
  onCopyLink?: () => void;
  /** Absent when the message cannot be sent to the Self Direct. */
  onSendToSelf?: () => void;
  onEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
  showQuoteButton: boolean;
  showPinButton: boolean;
  isPinned: boolean;
  showCopyButton: boolean;
  showCopyLinkButton: boolean;
  showEditButton: boolean;
  showDeleteButton: boolean;
  /** No header on the row, so the pill has no empty lane to park in. */
  isContinuation: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const frequentlyUsedEmojis = useFrequentlyUsedEmojis();
  const liveQuickReactions = resolveQuickReactions(
    frequentlyUsedEmojis,
    HOVER_QUICK_REACTION_COUNT,
  );
  // A reaction re-ranks the list. Hold the order the pointer found until it
  // leaves the pill, so the emojis never shift under it.
  const [heldQuickReactions, setHeldQuickReactions] = useState<
    readonly string[] | null
  >(null);

  function holdQuickReactionOrder() {
    setHeldQuickReactions((held) => held ?? liveQuickReactions);
  }

  return (
    <div
      data-message-actions="hover"
      className={cn(
        MESSAGE_ACTIONS_PILL_CLASS,
        messageActionsPillLiftClass(isContinuation),
        "hidden transition-[opacity,pointer-events] transition-discrete focus-within:opacity-100 [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:flex [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
        MESSAGE_ACTIONS_PILL_REVEAL_DELAY_CLASS,
        // The upper half covers the row above, and an opacity-0 pill still
        // takes clicks, so it takes the pointer only on row hover or focus.
        // Not while More is open: Radix makes the page inert, and an explicit
        // auto would let the click that closes the menu also hit the pill.
        moreOpen
          ? "[@media(hover:hover)]:opacity-100"
          : "focus-within:pointer-events-auto [@media(hover:hover)]:group-hover:pointer-events-auto",
      )}
      onPointerEnter={holdQuickReactionOrder}
      onPointerLeave={() => {
        setHeldQuickReactions(null);
      }}
    >
      <SokoBotChainBadge metadata={message.metadata} />
      <MessageActionControls
        message={message}
        quickReactions={heldQuickReactions ?? liveQuickReactions}
        onToggleReaction={onToggleReaction}
        onOpenThread={onOpenThread}
        onQuote={onQuote}
        onPin={onPin}
        onCopy={onCopy}
        onCopyLink={onCopyLink}
        onSendToSelf={onSendToSelf}
        onEdit={onEdit}
        onDelete={onDelete}
        showThreadButton={showThreadButton}
        showQuoteButton={showQuoteButton}
        showPinButton={showPinButton}
        isPinned={isPinned}
        showCopyButton={showCopyButton}
        showCopyLinkButton={showCopyLinkButton}
        showEditButton={showEditButton}
        showDeleteButton={showDeleteButton}
        collapseSecondary
        onMoreOpenChange={setMoreOpen}
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
  onPin,
  onCopy,
  onCopyLink,
  onSendToSelf,
  onEdit,
  onDelete,
  showThreadButton,
  showQuoteButton,
  showPinButton,
  isPinned,
  showCopyButton,
  showCopyLinkButton,
  showEditButton,
  showDeleteButton,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: ChatRoomMessage;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  onPin?: (message: ChatRoomMessage) => void;
  onCopy?: () => void;
  onCopyLink?: () => void;
  /** Absent when the message cannot be sent to the Self Direct. */
  onSendToSelf?: () => void;
  onEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
  showQuoteButton: boolean;
  showPinButton: boolean;
  isPinned: boolean;
  showCopyButton: boolean;
  showCopyLinkButton: boolean;
  showEditButton: boolean;
  showDeleteButton: boolean;
}) {
  const t = useTranslations("App.Channels");
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const { contentRef, swipeHandlers } = useBottomSheetSwipeDismiss(open, () => {
    onOpenChange(false);
  });
  const setSheetContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      setPortalHost(node);
    },
    [contentRef],
  );
  const whoReactedRows = message.reactions.flatMap((reaction) => {
    const whoReactedLabel = formatWhoReactedLabel(reaction, t);
    if (!whoReactedLabel) {
      return [];
    }
    return [{ emoji: reaction.emoji, whoReactedLabel }];
  });
  const frequentlyUsedEmojis = useFrequentlyUsedEmojis();
  const quickReactions = resolveQuickReactions(
    frequentlyUsedEmojis,
    SHEET_QUICK_REACTION_COUNT,
  );
  const reactedEmojis = readerReactedEmojis(message);

  function runAndClose(action: () => void) {
    action();
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={setSheetContentRef}
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
              className="bg-tertiary h-1.5 w-12 shrink-0 rounded-full"
              aria-hidden
            />
          </div>
          <SheetTitle>{t("Actions.more")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("Actions.more")}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap items-center justify-center gap-2 px-4 pb-4">
          {quickReactions.map((emoji) => (
            <Button
              key={emoji}
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "size-11 rounded-full text-xl",
                reactedEmojis.has(emoji) &&
                  "bg-primary-quinary hover:bg-primary-quaternary",
              )}
              aria-label={t("Reactions.toggle", { emoji })}
              aria-pressed={reactedEmojis.has(emoji)}
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
            portalContainer={portalHost}
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
          {showPinButton && onPin ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 justify-start gap-3 px-3"
              onClick={() => {
                runAndClose(() => {
                  onPin(message);
                });
              }}
            >
              {isPinned ? (
                <PinOff className="size-4 shrink-0" aria-hidden />
              ) : (
                <Pin className="size-4 shrink-0" aria-hidden />
              )}
              {isPinned ? t("PinnedMessages.unpin") : t("PinnedMessages.pin")}
            </Button>
          ) : null}
          {showCopyLinkButton && onCopyLink ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 justify-start gap-3 px-3"
              onClick={() => {
                runAndClose(onCopyLink);
              }}
            >
              <Link2 className="size-4 shrink-0" aria-hidden />
              {t("Copy.link")}
            </Button>
          ) : null}
          {onSendToSelf ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 justify-start gap-3 px-3"
              onClick={() => {
                runAndClose(onSendToSelf);
              }}
            >
              <Send className="size-4 shrink-0" aria-hidden />
              {t("Copy.sendToSelf")}
            </Button>
          ) : null}
          {showCopyButton && onCopy ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11 justify-start gap-3 px-3"
              onClick={() => {
                runAndClose(onCopy);
              }}
            >
              <Copy className="size-4 shrink-0" aria-hidden />
              {t("Copy.action")}
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
  mentions = {},
  usersById,
  usersBySlug,
  coworkersById,
  coworkersBySlug,
  sokoBotsById,
  sokoBotsBySlug,
  channels = [],
}: {
  value: string;
  originalContent: string;
  onChange: (value: string) => void;
  onSave: (content: string) => void;
  onCancel: () => void;
  isSaving: boolean;
  mentions?: Record<string, MentionRecordEntry<RoomMentionParticipant>>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
  coworkersById?: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug?: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
  channels?: readonly ComposerChannelOption[];
}) {
  const t = useTranslations("App.Channels");
  const editorRef = useRef<ComposerWysiwygEditorHandle>(null);
  const liveRef = useRef(value);
  liveRef.current = value;

  const mentionDisplay = useMemo(
    () =>
      composerMentionDisplayNames({
        usersById,
        usersBySlug,
        coworkersById,
        coworkersBySlug,
        sokoBotsById,
        sokoBotsBySlug,
        mentionCatalog: mentions,
      }),
    [
      coworkersById,
      coworkersBySlug,
      mentions,
      sokoBotsById,
      sokoBotsBySlug,
      usersById,
      usersBySlug,
    ],
  );

  useMountEffect(() => {
    editorRef.current?.focusAtEnd();
  });

  function liveMarkdown(): string {
    return editorRef.current?.getMarkdown() ?? liveRef.current;
  }

  function handleCommit() {
    if (isSaving) return;
    const markdown = liveMarkdown();
    const liveTrimmed = markdown.trim();
    const originalTrimmed = originalContent.trim();
    if (isRoomComposerContentOverLimit(liveTrimmed)) {
      toast.error(
        t("composerTooLong", {
          count: liveTrimmed.length,
          max: CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
        }),
      );
      return;
    }
    if (liveTrimmed.length > 0 && liveTrimmed !== originalTrimmed) {
      onSave(markdown);
      return;
    }
    onCancel();
  }

  const trimmedEditContent = value.trim();
  const editOverLimit = isRoomComposerContentOverLimit(trimmedEditContent);
  const showEditContentCount =
    isRoomComposerContentCountVisible(trimmedEditContent);

  return (
    <div className="pt-0.5">
      <div
        className={cn(
          "border-input focus-within:border-ring focus-within:ring-ring-halo dark:bg-quinary rounded-md border bg-transparent focus-within:ring-[3px]",
          isSaving && "pointer-events-none opacity-50",
        )}
      >
        <ComposerWysiwygEditor
          ref={editorRef}
          value={value}
          onChange={(next) => {
            liveRef.current = next;
            onChange(next);
          }}
          mentions={mentions}
          mentionDisplayByKey={mentionDisplay.byKey}
          mentionDisplayBySlug={mentionDisplay.bySlug}
          channels={channels}
          disabled={isSaving}
          ariaLabel={t("Edit.composerAria")}
          modifierEnterSubmits
          onSubmitShortcut={handleCommit}
          onEscape={() => {
            if (!isSaving) onCancel();
          }}
          onBlur={() => {
            if (isSaving) return;
            if (liveMarkdown().trim() === originalContent.trim()) {
              onCancel();
            }
          }}
          className="min-h-10 max-h-40 overflow-y-auto px-3 py-2.5 leading-6"
        />
      </div>
      {editOverLimit || showEditContentCount ? (
        <div className="flex items-start justify-between gap-2 pt-1">
          {editOverLimit ? (
            <p className="text-destructive text-xs" role="alert">
              {t("composerTooLongHint")}
            </p>
          ) : (
            <span />
          )}
          {showEditContentCount ? (
            <span
              className={cn(
                "text-xs tabular-nums",
                editOverLimit ? "text-destructive" : "text-muted-foreground",
              )}
              aria-live="polite"
            >
              {t("composerCharacterCount", {
                count: trimmedEditContent.length,
                max: CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
              })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Header (next to name): min width so spinner → check → time does not nudge.
 * Continuation gutter matches the avatar rail (`w-8`); icons only — no min-w.
 */
const OUTBOUND_HEADER_MARK_CLASS =
  "text-muted-foreground inline-flex min-w-11 items-center justify-start leading-none";
const OUTBOUND_GUTTER_MARK_CLASS =
  "text-muted-foreground inline-flex items-center justify-center leading-none";

/**
 * Left rail shared by avatar and continuation spacer so body text lines up.
 * Continuations omit wall-clock time (header of the 5‑min group is enough);
 * only outbound delivery marks may appear here.
 */
const MESSAGE_LEFT_RAIL_CLASS =
  "flex w-8 min-w-8 max-w-8 shrink-0 justify-center overflow-visible pt-0.5";

/**
 * Quiet dual-arc ring for classic outbound pending. Slow spin; static under
 * prefers-reduced-motion. Not the coworker Drive grid / thinking orb.
 */
function OutboundPendingSpinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cn(
        "text-muted-foreground animate-outbound-pending-spin motion-reduce:animate-none",
        className,
      )}
      data-testid="outbound-delivery-pending-spinner"
    >
      {/* Faint track — stays put under reduced motion so the mark still reads. */}
      <circle
        cx="8"
        cy="8"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity={0.28}
      />
      {/* Leading arc */}
      <path
        d="M8 2.5a5.5 5.5 0 0 1 4.76 2.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Trailing arc (opposite, softer) */}
      <path
        d="M8 13.5a5.5 5.5 0 0 1-4.76-2.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity={0.45}
      />
    </svg>
  );
}

/**
 * Timestamp slot for classic outbound:
 * - Header (`reserveHeaderWidth`): pending before delay = wall-clock; after =
 *   spinner; confirm may show check; settled = wall-clock.
 * - Gutter (`!reserveHeaderWidth`): marks only (spinner / fail / check) — never
 *   wall-clock (group header time is enough on continuation rows).
 * - Failed: alert immediately in both places.
 *
 * Settled wall-clock uses only the caller's className so color/size match
 * pre-outbound message chrome (muted meta, not body foreground).
 */
function MessageTimeOrOutboundStatus({
  createdAt,
  outboundStatus,
  showSentTick = false,
  className,
  /** Header next to name (true) vs continuation left gutter (false). */
  reserveHeaderWidth = true,
  outboundErrorMessage,
  outboundContentLength = 0,
}: {
  createdAt: Date | string;
  outboundStatus: OutboundDeliveryStatus | null;
  showSentTick?: boolean;
  className?: string;
  reserveHeaderWidth?: boolean;
  outboundErrorMessage?: string | null;
  outboundContentLength?: number;
}) {
  const t = useTranslations("App.Channels");
  const [sentFading, setSentFading] = useState(false);
  const [showPendingSpinner, setShowPendingSpinner] = useState(() =>
    outboundStatus === "pending"
      ? shouldShowOutboundPendingSpinner(createdAt)
      : false,
  );
  const isGutter = !reserveHeaderWidth;
  const markClass = reserveHeaderWidth
    ? OUTBOUND_HEADER_MARK_CLASS
    : OUTBOUND_GUTTER_MARK_CLASS;
  // Smaller icon in the narrow continuation gutter.
  const iconClass = reserveHeaderWidth ? "size-3" : "size-2.5";

  useEffect(() => {
    if (outboundStatus !== "pending") {
      setShowPendingSpinner(false);
      return;
    }
    if (shouldShowOutboundPendingSpinner(createdAt)) {
      setShowPendingSpinner(true);
      return;
    }
    setShowPendingSpinner(false);
    const remainingMs =
      OUTBOUND_PENDING_SPINNER_DELAY_MS - outboundPendingAgeMs(createdAt);
    const timeoutId = window.setTimeout(
      () => {
        setShowPendingSpinner(true);
      },
      Math.max(0, remainingMs),
    );
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [outboundStatus, createdAt]);

  useEffect(() => {
    if (!showSentTick) {
      setSentFading(false);
      return;
    }
    setSentFading(false);
    const fadeAt = window.setTimeout(() => {
      setSentFading(true);
    }, OUTBOUND_SENT_TICK_MS / 2);
    return () => {
      window.clearTimeout(fadeAt);
    };
  }, [showSentTick, createdAt]);

  if (outboundStatus === "pending") {
    if (!showPendingSpinner) {
      // Fast path: header keeps wall-clock; gutter stays empty.
      if (isGutter) {
        return null;
      }
      return <MessageWallClockTime value={createdAt} className={className} />;
    }
    return (
      <span
        className={cn(markClass, className)}
        role="img"
        data-testid="outbound-delivery-pending"
        title={t("Outbound.sending")}
        aria-label={t("Outbound.sending")}
      >
        <OutboundPendingSpinner className={iconClass} />
      </span>
    );
  }

  if (outboundStatus === "failed") {
    const failedLabel = formatRoomComposerTooLongFailure(
      outboundErrorMessage,
      outboundContentLength,
      t,
    );
    return (
      <span
        className={cn(markClass, "text-destructive", className)}
        role="img"
        data-testid="outbound-delivery-failed-icon"
        title={failedLabel}
        aria-label={failedLabel}
      >
        <AlertCircle
          className={cn(iconClass, "text-destructive")}
          aria-hidden
        />
      </span>
    );
  }

  if (showSentTick) {
    return (
      <span
        className={cn(markClass, className)}
        role="img"
        data-testid="outbound-delivery-sent"
        title={t("Outbound.sent")}
        aria-label={t("Outbound.sent")}
      >
        <Check
          className={cn(
            iconClass,
            "text-muted-foreground transition-opacity duration-500 ease-out",
            sentFading ? "opacity-0" : "opacity-100",
          )}
          aria-hidden
          strokeWidth={2.5}
        />
      </span>
    );
  }

  // Settled: wall-clock only on the header; gutter stays empty.
  if (isGutter) {
    return null;
  }
  return <MessageWallClockTime value={createdAt} className={className} />;
}

function FailedMentionActions({
  onRetryMention,
}: {
  onRetryMention?: () => void;
}) {
  const t = useTranslations("App.Channels");
  if (!onRetryMention) {
    return null;
  }
  return (
    <div
      className="flex w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-xs"
      data-testid="coworker-mention-failed"
    >
      <button
        type="button"
        className="text-primary hover:text-primary-hover font-medium"
        data-testid="coworker-mention-retry"
        onClick={onRetryMention}
      >
        {t("MentionStatus.retry")}
      </button>
    </div>
  );
}

function OutboundFailedActions({
  message,
  onRetryOutbound,
  onRemoveOutbound,
}: {
  message: ChatRoomMessage;
  onRetryOutbound?: (message: ChatRoomMessage) => void;
  onRemoveOutbound?: (message: ChatRoomMessage) => void;
}) {
  const t = useTranslations("App.Channels");
  const failedLabel = formatRoomComposerTooLongFailure(
    readOutboundErrorMessage(message),
    message.content.length,
    t,
  );
  return (
    <div
      className="text-muted-foreground flex w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-xs"
      data-testid="outbound-delivery-failed"
    >
      <span className="text-destructive" title={failedLabel}>
        {failedLabel}
      </span>
      {onRetryOutbound ? (
        <button
          type="button"
          className="text-primary hover:text-primary-hover font-medium"
          onClick={() => onRetryOutbound(message)}
        >
          {t("Outbound.retry")}
        </button>
      ) : null}
      {onRemoveOutbound ? (
        <button
          type="button"
          className="text-primary hover:text-primary-hover font-medium"
          onClick={() => onRemoveOutbound(message)}
        >
          {t("Outbound.remove")}
        </button>
      ) : null}
    </div>
  );
}

function MessageMetaFooter({
  message,
  onToggleReaction,
  onOpenThread,
  showThreadButton,
  isDeleted,
}: {
  message: ChatRoomMessage;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
  isDeleted: boolean;
}) {
  const t = useTranslations("App.Channels");
  const isOutboundLocal = isOutboundLocalMessage(message);

  return (
    <>
      {!isDeleted && !isOutboundLocal && message.reactions.length > 0 ? (
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
                        "border-primary-tertiary bg-primary-quinary text-primary",
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
          className="text-primary hover:text-primary-hover -mx-1 mt-1 min-h-9 px-1 text-xs font-medium sm:mt-1 sm:min-h-0"
          onClick={() => onOpenThread(message)}
        >
          {t("Thread.replyCount", { count: message.threadReplyCount })}
        </button>
      ) : null}
    </>
  );
}

export const ChatMessageRow = memo(function ChatMessageRow({
  message,
  coworkersById,
  coworkersBySlug,
  sokoBotsById,
  sokoBotsBySlug,
  usersById,
  usersBySlug,
  channelLinks = [],
  currentUserId,
  canOpenHumanDirect = false,
  onOpenDirectMessage,
  openingDirectParticipantKey = null,
  onToggleReaction,
  onOpenThread,
  onQuote,
  onPin,
  onStartEdit,
  onDelete,
  onRemoveUnfurl,
  onRetryOutbound,
  onRetryMention,
  onRemoveOutbound,
  onJumpToQuotedMessage,
  onSendToSelf,
  showOutboundSentTick = false,
  isEditing = false,
  editDraft = "",
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  isSavingEdit = false,
  mentions = {},
  channels = [],
  showThreadButton = true,
  showQuoteButton = true,
  showPinButton = false,
  isPinned = false,
  isContinuation = false,
  isFirstOfDay = false,
  seenBy,
}: {
  message: ChatRoomMessage;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  sokoBotsById?: Map<string, ChatRoomSokoBotParticipant>;
  sokoBotsBySlug?: Map<string, ChatRoomSokoBotParticipant>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
  channelLinks?: readonly ChannelLinkTarget[];
  currentUserId?: string;
  canOpenHumanDirect?: boolean;
  onOpenDirectMessage?: (profile: ChatParticipantHoverProfile) => void;
  openingDirectParticipantKey?: string | null;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  onPin?: (message: ChatRoomMessage) => void;
  onStartEdit?: (message: ChatRoomMessage) => void;
  onDelete?: (message: ChatRoomMessage) => void;
  onRemoveUnfurl?: (message: ChatRoomMessage, url: string) => void;
  onRetryOutbound?: (message: ChatRoomMessage) => void;
  onRetryMention?: (message: ChatRoomMessage) => void;
  onRemoveOutbound?: (message: ChatRoomMessage) => void;
  /** Quote tap: scroll the room transcript to the quoted message. */
  onJumpToQuotedMessage?: (messageId: string) => void;
  /** Send to yourself. The room omits it inside the Self Direct. */
  onSendToSelf?: (message: ChatRoomMessage) => void;
  /** Brief check in the timestamp slot after confirm (fades, then wall-clock). */
  showOutboundSentTick?: boolean;
  isEditing?: boolean;
  editDraft?: string;
  onEditDraftChange?: (value: string) => void;
  onCancelEdit?: () => void;
  /** Optional content uses the live editor value (avoids stale draft on Enter). */
  onSaveEdit?: (content?: string) => void;
  isSavingEdit?: boolean;
  mentions?: Record<string, MentionRecordEntry<RoomMentionParticipant>>;
  channels?: readonly ComposerChannelOption[];
  showThreadButton?: boolean;
  showQuoteButton?: boolean;
  showPinButton?: boolean;
  isPinned?: boolean;
  /** Slack-style continuation: omit avatar / name / wall-clock (group header time is enough). */
  isContinuation?: boolean;
  /** First message of a calendar day after a day separator; omit top margin because separator already provides rhythm. */
  isFirstOfDay?: boolean;
  /**
   * Seen by faces, pinned to the bottom-right of the message column. Newest
   * message only.
   */
  seenBy?: ReactNode;
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
  const isOutboundLocal = isOutboundLocalMessage(message);
  const outboundStatus = readOutboundDeliveryStatus(message);
  const clientTurnId = readClientTurnId(message);
  // Sync registry covers the first settled paint when React tick state lags.
  const showDeliveryTick =
    showOutboundSentTick || isOutboundSentTickActive(message.id, clientTurnId);
  const isDeleted = message.deletedAt != null;
  const thoughtView = useMemo(() => {
    if (message.sender.type !== "coworker" || isDeleted) {
      return null;
    }
    return resolveCoworkerThoughtViewModel({
      content: message.content,
      isStreamOverlay,
      metadata: message.metadata,
    });
  }, [
    isDeleted,
    isStreamOverlay,
    message.content,
    message.metadata,
    message.sender.type,
  ]);
  const isThinking =
    thoughtView?.showThinkingFallback === true ||
    (thoughtView != null &&
      thoughtView.liveBeat != null &&
      message.content.trim().length === 0);
  const canQuote =
    showQuoteButton &&
    Boolean(onQuote) &&
    !isStreamOverlay &&
    !isOutboundLocal &&
    !isDeleted;
  const canPin =
    showPinButton &&
    Boolean(onPin) &&
    message.parentMessageId == null &&
    !isStreamOverlay &&
    !isOutboundLocal &&
    !isDeleted;
  const canEdit =
    Boolean(onStartEdit) &&
    Boolean(currentUserId) &&
    message.sender.type === "user" &&
    message.sender.user.id === currentUserId &&
    !isStreamOverlay &&
    !isOutboundLocal &&
    !isDeleted;
  const canDelete =
    Boolean(onDelete) &&
    Boolean(currentUserId) &&
    !isDeleted &&
    !isStreamOverlay &&
    !isOutboundLocal &&
    message.sender.type === "user" &&
    message.sender.user.id === currentUserId;
  const canRemoveUnfurl =
    Boolean(onRemoveUnfurl) &&
    Boolean(currentUserId) &&
    !isDeleted &&
    !isStreamOverlay &&
    !isOutboundLocal &&
    message.sender.type === "user" &&
    message.sender.user.id === currentUserId;
  const editedAt = message.editedAt;
  const showEdited = !isDeleted && editedAt != null;
  const showPinned = !isDeleted && isPinned;
  const quote = message.quote;
  // The faces are pinned to the row's bottom-right corner, so only whatever
  // renders last in the column can run under them. When anything follows the
  // body — reactions, a thread link, an unfurl, the failed-outbound row — the
  // text is already clear and needs no reserve at all. Keep this in step with
  // what the column actually renders below `ChannelMessageBody`.
  const hasReactionRow =
    !isDeleted && !isOutboundLocal && message.reactions.length > 0;
  const hasThreadLink =
    showThreadButton &&
    !isOutboundLocal &&
    message.threadReplyCount > 0 &&
    onOpenThread != null;
  const bodyEndsTheRow =
    seenBy != null &&
    !isEditing &&
    !hasReactionRow &&
    !hasThreadLink &&
    (message.unfurls ?? []).length === 0 &&
    outboundStatus !== "failed";
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // Neither overlay is mounted until first opened. A closed Radix dialog
  // still costs a root, a portal, and its contexts per row, and a transcript
  // carries a couple of hundred rows. Once opened it stays mounted so its
  // exit animation can run.
  const [sheetMounted, setSheetMounted] = useState(false);
  const [deleteDialogMounted, setDeleteDialogMounted] = useState(false);
  // The hover action pill and the participant hover cards only matter once
  // the pointer enters the row or focus lands inside it. Until then the row
  // renders neither, so a 200-row transcript and a jump merge skip six
  // buttons, a popover root, a dropdown root, and two hover-card roots per
  // row. The latch never resets; a hovered row keeps its chrome.
  const [interacted, setInteracted] = useState(false);
  function markInteracted() {
    if (!interacted) {
      setInteracted(true);
    }
  }
  function openSheet() {
    setSheetMounted(true);
    setSheetOpen(true);
  }
  const longPress = useLongPress(openSheet);
  const showActions =
    !isThinking && !isDeleted && !isEditing && !isOutboundLocal;
  const isDurableRoomMessage =
    !isDeleted &&
    !isThinking &&
    !isEditing &&
    !isOutboundLocal &&
    !isStreamOverlay;
  const canCopy = isDurableRoomMessage && message.content.trim().length > 0;
  const canCopyLink = isDurableRoomMessage;
  const canSendToSelf = isDurableRoomMessage && onSendToSelf != null;

  function handleCopy() {
    void copyTextWithToast(message.content, {
      copySuccessMessage: tChannels("Copy.success"),
      copyErrorMessage: tChannels("Copy.error"),
    });
  }

  function handleCopyLink() {
    void copyTextWithToast(
      `${window.location.origin}${chatRoomMessageHref(message.roomId, message.id)}`,
      {
        copySuccessMessage: tChannels("Copy.linkSuccess"),
        copyErrorMessage: tChannels("Copy.linkError"),
      },
    );
  }

  function handleSendToSelf() {
    onSendToSelf?.(message);
  }

  function requestDelete(_message: ChatRoomMessage) {
    setSheetOpen(false);
    setDeleteDialogMounted(true);
    setDeleteDialogOpen(true);
  }

  function confirmDelete() {
    onDelete?.(message);
    setDeleteDialogOpen(false);
  }

  // A use counts once per emoji until the message's confirmed reactions
  // change. Taps while a request is out flip a Pending reaction whose "off"
  // state is the confirmed row itself, so on/off/on records the emoji once.
  const recordedUsesRef = useRef<{
    reactions: ChatRoomMessage["reactions"];
    emojis: Set<string>;
  } | null>(null);

  // Every reaction path in the row (pill, sheet, picker, existing chips) lands
  // here, so adding one teaches the quick reactions. Removing one does not.
  function handleToggleReaction(target: ChatRoomMessage, emoji: string) {
    if (!readerReactedEmojis(target).has(emoji)) {
      if (recordedUsesRef.current?.reactions !== target.reactions) {
        recordedUsesRef.current = {
          reactions: target.reactions,
          emojis: new Set(),
        };
      }
      if (!recordedUsesRef.current.emojis.has(emoji)) {
        recordedUsesRef.current.emojis.add(emoji);
        recordEmojiUse(emoji);
      }
    }
    onToggleReaction(target, emoji);
  }

  return (
    <article
      id={`message-${message.id}`}
      data-message-id={message.id}
      aria-label={isContinuation ? sender.name : undefined}
      className={cn(
        // Landed mark: a left rail plus a wash, drawn on ::before/::after under
        // the content (`isolate` scopes their z-index -1 to the row). Nothing
        // paints outside the row, so the scroller cannot clip it. The styling
        // itself lives in globals.css, keyed on data-search-landed.
        // pr-2, not a pill-sized gutter: the text runs the full width and the
        // action pill draws over it, as Slack's does. The pill is opaque and
        // only shows on the row under the pointer, so what it covers is the
        // end of one line of a message you are already looking at — cheaper
        // than 16rem that every row gives up forever so that one hovered row
        // has somewhere to put eight buttons.
        "group relative isolate -mx-2 flex min-w-0 max-w-full gap-3.5 overflow-x-clip rounded-md px-2 transition-colors hover:bg-card-background",
        showActions && TOUCH_MESSAGE_SELECT_NONE_CLASS,
        isContinuation
          ? "min-h-0 py-0.5"
          : isFirstOfDay
            ? "mt-0 min-h-0 pt-1 pb-0.5"
            : "mt-2 min-h-0 pt-1 pb-0.5",
      )}
      {...(showActions ? longPress : {})}
      onPointerEnter={markInteracted}
      onFocus={markInteracted}
    >
      {isContinuation ? (
        // Same width as avatar rail so continuation body lines up with header body.
        // No wall-clock: group header time covers the 5‑min burst.
        <div
          className={MESSAGE_LEFT_RAIL_CLASS}
          data-testid="message-continuation-rail"
          aria-hidden={
            outboundStatus == null && !showDeliveryTick ? true : undefined
          }
        >
          {/* Gutter: marks only (reserveHeaderWidth=false → no wall-clock). */}
          {outboundStatus != null || showDeliveryTick ? (
            <MessageTimeOrOutboundStatus
              createdAt={message.createdAt}
              outboundStatus={outboundStatus}
              showSentTick={showDeliveryTick}
              reserveHeaderWidth={false}
              outboundErrorMessage={readOutboundErrorMessage(message)}
              outboundContentLength={message.content.length}
              className="text-muted-foreground leading-none"
            />
          ) : null}
        </div>
      ) : (
        <ChatParticipantHoverCard
          profile={hoverProfile}
          side="top"
          align="start"
          // self-start: article is flex; stretch made this full row height so absolute badge sat at bottom
          className="mt-0.5 shrink-0 self-start"
          currentUserId={currentUserId}
          canOpenHumanDirect={canOpenHumanDirect}
          onOpenDirect={onOpenDirectMessage}
          isOpeningDirect={isOpeningDirect}
          isDirectActionBusy={isDirectActionBusy}
          active={interacted}
        >
          <span
            data-testid="message-sender-avatar"
            className="relative inline-flex size-8 shrink-0"
          >
            {sender.kind === "sokoBot" && sender.avatarSeed && !sender.image ? (
              <AuroraOrb
                seed={sender.avatarSeed}
                size={64}
                alt=""
                className="ring-border size-8 ring-1"
              />
            ) : (
              <Avatar className="size-8">
                <AvatarImage src={sender.image ?? undefined} alt="" />
                <AvatarFallback className="text-xs">
                  {getInitials(sender.name)}
                </AvatarFallback>
              </Avatar>
            )}
            {sender.kind === "coworker" ? <AiCoworkerAvatarBadge /> : null}
          </span>
        </ChatParticipantHoverCard>
      )}
      <div
        className={cn(
          "min-w-0 max-w-full flex-1 overflow-x-clip",
          isContinuation ? "space-y-1" : "space-y-1.5",
          // No reserve here: padding on the column shortens every line to
          // protect the one that can collide. The reserve is inline, on the
          // last line only — see SEEN_BY_INLINE_RESERVE_CLASS.
        )}
      >
        {isContinuation ? (
          // No header on a continuation; a trailing cue would sit below long bodies.
          showPinned ? (
            <MessagePinnedLabel className="block" />
          ) : null
        ) : (
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
              active={interacted}
            >
              <span className="truncate text-base font-semibold md:text-sm">
                {sender.name}
              </span>
            </ChatParticipantHoverCard>
            <MessageTimeOrOutboundStatus
              createdAt={message.createdAt}
              outboundStatus={outboundStatus}
              showSentTick={showDeliveryTick}
              reserveHeaderWidth
              outboundErrorMessage={readOutboundErrorMessage(message)}
              outboundContentLength={message.content.length}
              className="text-muted-foreground text-xs leading-none"
            />
            {showEdited && editedAt != null ? (
              <MessageEditedLabel editedAt={editedAt} />
            ) : null}
            {showPinned ? <MessagePinnedLabel /> : null}
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
                  messageId={message.id}
                  roomId={message.roomId}
                  quote={quote}
                  coworkersById={coworkersById}
                  coworkersBySlug={coworkersBySlug}
                  sokoBotsById={sokoBotsById}
                  sokoBotsBySlug={sokoBotsBySlug}
                  usersById={usersById}
                  usersBySlug={usersBySlug}
                  channelLinks={channelLinks}
                  currentUserId={currentUserId}
                  canOpenHumanDirect={canOpenHumanDirect}
                  onOpenDirectMessage={onOpenDirectMessage}
                  openingDirectParticipantKey={openingDirectParticipantKey}
                  onJumpToQuotedMessage={onJumpToQuotedMessage}
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
                  mentions={mentions}
                  usersById={usersById}
                  usersBySlug={usersBySlug}
                  coworkersById={coworkersById}
                  coworkersBySlug={coworkersBySlug}
                  sokoBotsById={sokoBotsById}
                  sokoBotsBySlug={sokoBotsBySlug}
                  channels={channels}
                />
              ) : isFailedMentionThoughtShell(message.metadata) ? (
                <>
                  <CoworkerFailedThoughtSparkle
                    label={tChannels("MentionStatus.failed")}
                  />
                  <FailedMentionActions
                    onRetryMention={
                      onRetryMention ? () => onRetryMention(message) : undefined
                    }
                  />
                </>
              ) : thoughtView?.showThinkingFallback ||
                thoughtView?.liveBeat != null ? (
                <CoworkerLiveThought
                  label={tChat("reasoning.thinking")}
                  liveBeat={thoughtView.liveBeat}
                  startedAtMs={
                    extractThoughtStartedAtMs(message.metadata) ??
                    new Date(message.createdAt).getTime()
                  }
                />
              ) : (
                <>
                  {thoughtView?.disclosure ? (
                    <div className="mb-1">
                      <CoworkerThoughtTrace
                        working={false}
                        headerLabel={
                          thoughtView.disclosure.durationSeconds != null
                            ? tChat("reasoning.thoughtForDuration", {
                                duration: formatThoughtDurationLabel(
                                  thoughtView.disclosure.durationSeconds,
                                ),
                              })
                            : tChat("reasoning.expandSteps")
                        }
                        bodyText={thoughtView.disclosure.text}
                        defaultExpanded={false}
                      />
                    </div>
                  ) : null}
                  {/* Send to yourself posts only a quote, so there is no body. */}
                  {quote && !message.content.trim() ? null : (
                    <ChannelMessageBody
                      messageId={message.id}
                      content={message.content}
                      coworkersById={coworkersById}
                      coworkersBySlug={coworkersBySlug}
                      sokoBotsById={sokoBotsById}
                      sokoBotsBySlug={sokoBotsBySlug}
                      usersById={usersById}
                      usersBySlug={usersBySlug}
                      channelLinks={channelLinks}
                      currentUserId={currentUserId}
                      canOpenHumanDirect={canOpenHumanDirect}
                      onOpenDirectMessage={onOpenDirectMessage}
                      openingDirectParticipantKey={openingDirectParticipantKey}
                      trailing={
                        (isContinuation && showEdited && editedAt != null) ||
                        bodyEndsTheRow ? (
                          <>
                            {isContinuation &&
                            showEdited &&
                            editedAt != null ? (
                              <MessageEditedLabel
                                editedAt={editedAt}
                                className="ms-1.5 inline-flex h-6 items-center"
                              />
                            ) : null}
                            {bodyEndsTheRow ? (
                              <span
                                aria-hidden="true"
                                data-testid="seen-by-inline-reserve"
                                className={SEEN_BY_INLINE_RESERVE_CLASS}
                              />
                            ) : null}
                          </>
                        ) : null
                      }
                    />
                  )}
                  <MessageUnfurlList
                    unfurls={message.unfurls}
                    canRemove={canRemoveUnfurl}
                    onRemove={
                      onRemoveUnfurl
                        ? (url) => onRemoveUnfurl(message, url)
                        : undefined
                    }
                  />
                  <SokoBotMessageFooter metadata={message.metadata} />
                </>
              )}
            </>
          )}
        </div>
        {outboundStatus === "failed" && !isEditing ? (
          <OutboundFailedActions
            message={message}
            onRetryOutbound={onRetryOutbound}
            onRemoveOutbound={onRemoveOutbound}
          />
        ) : null}
        {!isEditing ? (
          <MessageMetaFooter
            message={message}
            onToggleReaction={handleToggleReaction}
            onOpenThread={onOpenThread}
            showThreadButton={showThreadButton && !isOutboundLocal}
            isDeleted={isDeleted}
          />
        ) : null}
      </div>
      {/* Out of the text flow, in the row's bottom-right corner. Costs the
          row no height at all, which is the whole reason it is here rather
          than trailing the last line.
          `end-2` is the action pill's own edge, so the two share a vertical
          line and the faces land in the same corner on every row. */}
      {seenBy ? (
        <div className="absolute end-2 bottom-1 z-10">{seenBy}</div>
      ) : null}
      {showActions ? (
        <>
          {/* Always mounted, and ahead of the pill in DOM order: on a row
              whose body has no other tab stop this is the first stop, it
              mounts the pill, and the next Tab then walks into it. */}
          <button
            type="button"
            className="sr-only"
            onClick={() => {
              openSheet();
            }}
          >
            {tChannels("Actions.more")}
          </button>
          {interacted ? (
            <MessageActions
              message={message}
              onToggleReaction={handleToggleReaction}
              onOpenThread={onOpenThread}
              onQuote={onQuote}
              onPin={onPin}
              onCopy={handleCopy}
              onCopyLink={handleCopyLink}
              onSendToSelf={canSendToSelf ? handleSendToSelf : undefined}
              onEdit={onStartEdit}
              onDelete={requestDelete}
              showThreadButton={showThreadButton}
              showQuoteButton={canQuote}
              showPinButton={canPin}
              isPinned={isPinned}
              showCopyButton={false}
              showCopyLinkButton={canCopyLink}
              showEditButton={canEdit}
              showDeleteButton={canDelete}
              isContinuation={isContinuation}
            />
          ) : null}
          {sheetMounted ? (
            <TouchMessageActionsSheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              message={message}
              onToggleReaction={handleToggleReaction}
              onOpenThread={onOpenThread}
              onQuote={onQuote}
              onPin={onPin}
              onCopy={handleCopy}
              onCopyLink={handleCopyLink}
              onSendToSelf={canSendToSelf ? handleSendToSelf : undefined}
              onEdit={onStartEdit}
              onDelete={requestDelete}
              showThreadButton={showThreadButton}
              showQuoteButton={canQuote}
              showPinButton={canPin}
              isPinned={isPinned}
              showCopyButton={canCopy}
              showCopyLinkButton={canCopyLink}
              showEditButton={canEdit}
              showDeleteButton={canDelete}
            />
          ) : null}
        </>
      ) : null}
      {canDelete && deleteDialogMounted ? (
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
});

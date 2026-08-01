"use client";

import {
  findMarkdownLinks,
  isFileLikeUrl,
  unescapeMarkdownLinkUrl,
} from "@sokosumi/utils";
import { CheckCircle2, Loader2, MessageCircle, Quote } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode } from "react";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomMessageQuote,
  ChatRoomMessageReaction,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";
import { AiCoworkerIcon } from "./room-draft-shared";
import {
  formatMessageTime,
  formatRoomMarkdownMentions,
  messageSender,
  scrollToRoomMessageElement,
} from "./room-helpers";

type UserMentionLookup = Pick<ChatRoomUserParticipant, "id" | "name">;
type RoomMessageQuoteSnapshot = Exclude<ChatRoomMessageQuote, null>;

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

  return (
    <button
      type="button"
      className="border-border bg-muted/40 hover:bg-muted/70 focus-visible:ring-ring mb-1.5 w-full rounded-md border-l-2 border-l-primary/60 px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2"
      aria-label={t("jump", { author: quote.authorName })}
      onClick={() => {
        scrollToRoomMessageElement(quote.messageId);
      }}
    >
      <div className="text-foreground truncate text-xs font-semibold">
        {quote.authorName}
      </div>
      <div className="text-muted-foreground text-xs leading-5 whitespace-pre-line">
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
    </button>
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
    <Markdown className="prose-p:my-0 prose-p:leading-6 prose-ul:my-1 prose-ol:my-1 prose-pre:my-2">
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
  const fileLinks = findMarkdownLinks(content)
    .map((link) => ({
      ...link,
      url: unescapeMarkdownLinkUrl(link.rawUrl),
    }))
    .filter((link) => isFileLikeUrl(link.url));

  if (fileLinks.length === 0) {
    return (
      <ChannelMarkdownSegment
        content={content}
        coworkersById={coworkersById}
        coworkersBySlug={coworkersBySlug}
        usersById={usersById}
        usersBySlug={usersBySlug}
      />
    );
  }

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  fileLinks.forEach((link, index) => {
    if (link.index > lastIndex) {
      nodes.push(
        <ChannelMarkdownSegment
          key={`message-${index}-before`}
          content={content.slice(lastIndex, link.index)}
          coworkersById={coworkersById}
          coworkersBySlug={coworkersBySlug}
          usersById={usersById}
          usersBySlug={usersBySlug}
        />,
      );
    }
    nodes.push(
      <div key={`${link.index}-${link.url}`} className="my-2 flex">
        <FileChipMiniPreviewWithMetadata
          url={link.url}
          fileName={link.text}
          sizeClass="size-16"
        />
      </div>,
    );
    lastIndex = link.index + link.match.length;
  });
  if (lastIndex < content.length) {
    nodes.push(
      <ChannelMarkdownSegment
        key="message-after"
        content={content.slice(lastIndex)}
        coworkersById={coworkersById}
        coworkersBySlug={coworkersBySlug}
        usersById={usersById}
        usersBySlug={usersBySlug}
      />,
    );
  }

  return <>{nodes}</>;
}

function MessageActions({
  message,
  onToggleReaction,
  onOpenThread,
  onQuote,
  showThreadButton,
  showQuoteButton,
}: {
  message: ChatRoomMessage;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
  showQuoteButton: boolean;
}) {
  const t = useTranslations("App.Channels");

  return (
    <div className="border-border bg-background absolute top-1.5 right-2 flex items-center gap-0.5 rounded-full border p-0.5 shadow-sm transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
      <EmojiPicker
        title={t("Reactions.add")}
        ariaLabel={t("Reactions.add")}
        align="end"
        triggerClassName="size-9 rounded-full sm:size-7"
        onPick={(emoji) => onToggleReaction(message, emoji)}
      />
      {showQuoteButton && onQuote ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-full sm:size-7"
          title={t("Quote.action")}
          aria-label={t("Quote.action")}
          onClick={() => onQuote(message)}
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
          onClick={() => onOpenThread(message)}
        >
          <MessageCircle className="size-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

function MessageMetaFooter({
  message,
  coworkersById,
  onToggleReaction,
  onOpenThread,
  showThreadButton,
}: {
  message: ChatRoomMessage;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
}) {
  const t = useTranslations("App.Channels");

  return (
    <>
      {message.reactions.length > 0 ? (
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
      {message.mentions.length > 0 ? (
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
  onToggleReaction,
  onOpenThread,
  onQuote,
  showThreadButton = true,
  showQuoteButton = true,
  isContinuation = false,
}: {
  message: ChatRoomMessage;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  usersById?: Map<string, UserMentionLookup>;
  usersBySlug?: Map<string, UserMentionLookup>;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  onQuote?: (message: ChatRoomMessage) => void;
  showThreadButton?: boolean;
  showQuoteButton?: boolean;
  /** Slack-style continuation: omit avatar / name / primary timestamp. */
  isContinuation?: boolean;
}) {
  const tChat = useTranslations("App.Chat.Chat");
  const sender = messageSender(message);
  const isStreamOverlay = message.id.startsWith("stream:");
  const isThinking =
    isStreamOverlay &&
    message.sender.type === "coworker" &&
    message.content.trim().length === 0;
  const formattedTime = formatMessageTime(message.createdAt);
  const createdAtIso = new Date(message.createdAt).toISOString();
  const canQuote = showQuoteButton && Boolean(onQuote) && !isStreamOverlay;
  const quote = message.quote;

  return (
    <article
      id={`message-${message.id}`}
      data-message-id={message.id}
      aria-label={isContinuation ? sender.name : undefined}
      className={cn(
        "group relative -mx-2 flex gap-3.5 rounded-md pr-20 pl-2 transition-colors hover:bg-muted/45",
        isContinuation ? "min-h-0 py-0.5" : "mt-3 min-h-0 pt-1 pb-0.5",
      )}
    >
      {isContinuation ? (
        <div className="flex w-8 shrink-0 justify-center pt-0.5">
          <time
            dateTime={createdAtIso}
            className="text-muted-foreground whitespace-nowrap text-[10px] leading-4 tabular-nums opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            title={formattedTime}
            suppressHydrationWarning
          >
            {formattedTime}
          </time>
        </div>
      ) : (
        <Avatar className="mt-0.5 size-8 shrink-0">
          <AvatarImage src={sender.image ?? undefined} alt="" />
          <AvatarFallback className="text-xs">
            {getInitials(sender.name)}
          </AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn(
          "min-w-0 flex-1",
          isContinuation ? "space-y-1" : "space-y-1.5",
        )}
      >
        {isContinuation ? null : (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="truncate text-sm font-semibold">
              {sender.name}
            </span>
            {sender.kind === "coworker" ? <AiCoworkerIcon /> : null}
            <time
              dateTime={createdAtIso}
              className="text-muted-foreground text-xs"
              suppressHydrationWarning
            >
              {formattedTime}
            </time>
          </div>
        )}
        <div className="text-foreground wrap-break-word text-sm leading-6">
          {quote ? (
            <MessageQuoteBlock
              quote={quote}
              coworkersById={coworkersById}
              coworkersBySlug={coworkersBySlug}
              usersById={usersById}
              usersBySlug={usersBySlug}
            />
          ) : null}
          {isThinking ? (
            <span
              className="reasoning-text-shine text-sm leading-5"
              role="status"
              aria-live="polite"
            >
              {tChat("reasoning.thinking")}
            </span>
          ) : (
            <ChannelMessageText
              content={message.content}
              coworkersById={coworkersById}
              coworkersBySlug={coworkersBySlug}
              usersById={usersById}
              usersBySlug={usersBySlug}
            />
          )}
        </div>
        <MessageMetaFooter
          message={message}
          coworkersById={coworkersById}
          onToggleReaction={onToggleReaction}
          onOpenThread={onOpenThread}
          showThreadButton={showThreadButton}
        />
      </div>
      {!isThinking ? (
        <MessageActions
          message={message}
          onToggleReaction={onToggleReaction}
          onOpenThread={onOpenThread}
          onQuote={onQuote}
          showThreadButton={showThreadButton}
          showQuoteButton={canQuote}
        />
      ) : null}
    </article>
  );
}

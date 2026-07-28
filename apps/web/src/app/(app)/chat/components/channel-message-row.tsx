"use client";

import {
  findMarkdownLinks,
  isFileLikeUrl,
  unescapeMarkdownLinkUrl,
} from "@sokosumi/utils";
import { CheckCircle2, Loader2, MessageCircle, SmilePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { ROOM_COMPOSER_EMOJIS } from "@/components/chat/room-message-composer";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";
import { AiCoworkerIcon } from "./channel-draft-shared";
import {
  formatChannelMarkdownMentions,
  formatMessageTime,
  messageSender,
} from "./channel-helpers";

function ChannelMarkdownSegment({
  content,
  coworkersById,
  coworkersBySlug,
}: {
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
}) {
  if (!content.trim()) {
    return null;
  }

  return (
    <Markdown className="prose-p:my-0 prose-p:leading-7 prose-ul:my-1 prose-ol:my-1 prose-pre:my-2">
      {formatChannelMarkdownMentions({
        content,
        coworkersById,
        coworkersBySlug,
      })}
    </Markdown>
  );
}

function ChannelMessageText({
  content,
  coworkersById,
  coworkersBySlug,
}: {
  content: string;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
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
      />,
    );
  }

  return <>{nodes}</>;
}

function MessageEmojiPicker({
  onSelect,
  label,
}: {
  onSelect: (emoji: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-full sm:size-7"
          title={label}
          aria-label={label}
        >
          <SmilePlus className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        <div className="grid grid-cols-6 gap-1">
          {ROOM_COMPOSER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="hover:bg-muted focus-visible:ring-ring flex size-8 items-center justify-center rounded-md text-lg outline-none transition focus-visible:ring-2"
              onClick={() => {
                onSelect(emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MessageActions({
  message,
  onToggleReaction,
  onOpenThread,
  showThreadButton,
  align,
}: {
  message: ChatRoomMessage;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
  align: "start" | "end";
}) {
  const t = useTranslations("App.Channels");

  return (
    <div
      className={cn(
        "border-border bg-background absolute top-1.5 flex items-center gap-0.5 rounded-full border p-0.5 shadow-sm transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
        align === "end" ? "left-2" : "right-2",
      )}
    >
      <MessageEmojiPicker
        label={t("Reactions.add")}
        onSelect={(emoji) => onToggleReaction(message, emoji)}
      />
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
  onToggleReaction,
  onOpenThread,
  showThreadButton,
  align,
}: {
  message: ChatRoomMessage;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  showThreadButton: boolean;
  align: "start" | "end";
}) {
  const t = useTranslations("App.Channels");

  return (
    <>
      {message.reactions.length > 0 ? (
        <div
          className={cn(
            "flex flex-wrap gap-1.5 pt-1",
            align === "end" && "justify-end",
          )}
        >
          {message.reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              onClick={() => onToggleReaction(message, reaction.emoji)}
              className={cn(
                "border-border bg-background hover:bg-muted inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors sm:h-7 sm:px-2",
                reaction.reactedByCurrentUser &&
                  "border-primary/30 bg-primary/10 text-primary",
              )}
              aria-label={t("Reactions.toggle", { emoji: reaction.emoji })}
            >
              <span className="text-sm leading-none">{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </button>
          ))}
        </div>
      ) : null}
      {showThreadButton && message.threadReplyCount > 0 && onOpenThread ? (
        <button
          type="button"
          className={cn(
            "text-primary hover:text-primary/80 -mx-1 mt-1 min-h-9 px-1 text-xs font-medium sm:mt-1 sm:min-h-0",
            align === "end" && "self-end",
          )}
          onClick={() => onOpenThread(message)}
        >
          {t("Thread.replyCount", { count: message.threadReplyCount })}
        </button>
      ) : null}
      {message.mentions.length > 0 ? (
        <div
          className={cn(
            "flex flex-wrap gap-1.5 pt-1.5",
            align === "end" && "justify-end",
          )}
        >
          {message.mentions.map((mention) => (
            <Badge
              key={mention.id}
              variant={mention.status === "failed" ? "destructive" : "outline"}
            >
              {mention.status === "responded" ? (
                <CheckCircle2 className="size-3" />
              ) : mention.status === "failed" ? null : (
                <Loader2 className="size-3 animate-spin" />
              )}
              {t(`MentionStatus.${mention.status}`)}
            </Badge>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function ChatMessageRow({
  message,
  coworkersById,
  coworkersBySlug,
  onToggleReaction,
  onOpenThread,
  showThreadButton = true,
  layout = "channel",
  currentUserId,
}: {
  message: ChatRoomMessage;
  coworkersById: Map<string, ChatRoomCoworkerParticipant>;
  coworkersBySlug: Map<string, ChatRoomCoworkerParticipant>;
  onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
  onOpenThread?: (message: ChatRoomMessage) => void;
  showThreadButton?: boolean;
  /** `bubble` = IM layout (mine right, others left). Default Slack-style channel. */
  layout?: "channel" | "bubble";
  currentUserId?: string;
}) {
  const tChat = useTranslations("App.Chat.Chat");
  const sender = messageSender(message);
  const isStreamOverlay = message.id.startsWith("stream:");
  const isThinking =
    isStreamOverlay &&
    message.sender.type === "coworker" &&
    message.content.trim().length === 0;
  const isMine =
    message.sender.type === "user" &&
    Boolean(currentUserId) &&
    message.sender.user.id === currentUserId;

  if (layout === "bubble") {
    return (
      <article
        className={cn(
          "group relative flex min-h-11 gap-3 px-2 py-2",
          isMine ? "flex-row-reverse" : "flex-row",
        )}
      >
        <Avatar className="mt-0.5 size-8 shrink-0">
          <AvatarImage src={sender.image ?? undefined} alt="" />
          <AvatarFallback className="text-xs">
            {getInitials(sender.name)}
          </AvatarFallback>
        </Avatar>
        <div
          className={cn(
            "flex min-w-0 flex-col gap-1",
            // Column already capped on wide screens; mine stays short bubble,
            // others use most of the column like classic coworker chat.
            isMine
              ? "max-w-[min(85%,28rem)] items-end"
              : "w-full max-w-full items-start",
          )}
        >
          {isThinking ? (
            <span
              className="reasoning-text-shine pt-1 text-sm leading-5"
              role="status"
              aria-live="polite"
            >
              {tChat("reasoning.thinking")}
            </span>
          ) : (
            <>
              {!isMine ? (
                <div className="flex min-w-0 items-center gap-1.5 px-0.5">
                  <span className="truncate text-sm font-semibold">
                    {sender.name}
                  </span>
                  {sender.kind === "coworker" ? (
                    <AiCoworkerIcon className="size-3" />
                  ) : null}
                </div>
              ) : null}
              <div
                className={cn(
                  "wrap-break-word text-sm leading-7",
                  isMine
                    ? "bg-muted text-foreground rounded-2xl px-4 py-2"
                    : "text-foreground px-0.5",
                )}
              >
                <ChannelMessageText
                  content={message.content}
                  coworkersById={coworkersById}
                  coworkersBySlug={coworkersBySlug}
                />
              </div>
              <time
                className="text-muted-foreground px-0.5 text-xs"
                suppressHydrationWarning
              >
                {formatMessageTime(message.createdAt)}
              </time>
              <MessageMetaFooter
                message={message}
                onToggleReaction={onToggleReaction}
                onOpenThread={onOpenThread}
                showThreadButton={showThreadButton && !isStreamOverlay}
                align={isMine ? "end" : "start"}
              />
            </>
          )}
        </div>
        {!isThinking && !isStreamOverlay ? (
          <MessageActions
            message={message}
            onToggleReaction={onToggleReaction}
            onOpenThread={onOpenThread}
            showThreadButton={showThreadButton}
            align={isMine ? "end" : "start"}
          />
        ) : null}
      </article>
    );
  }

  return (
    <article className="group relative -mx-2 flex min-h-11 gap-3.5 rounded-md py-2.5 pr-20 pl-2 transition-colors hover:bg-muted/45">
      <Avatar className="mt-0.5 size-8 shrink-0">
        <AvatarImage src={sender.image ?? undefined} alt="" />
        <AvatarFallback className="text-xs">
          {getInitials(sender.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="truncate text-sm font-semibold">{sender.name}</span>
          {sender.kind === "coworker" ? <AiCoworkerIcon /> : null}
          <time
            className="text-muted-foreground text-xs"
            suppressHydrationWarning
          >
            {formatMessageTime(message.createdAt)}
          </time>
        </div>
        <div className="text-foreground wrap-break-word text-sm leading-7">
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
            />
          )}
        </div>
        <MessageMetaFooter
          message={message}
          onToggleReaction={onToggleReaction}
          onOpenThread={onOpenThread}
          showThreadButton={showThreadButton}
          align="start"
        />
      </div>
      {!isThinking ? (
        <MessageActions
          message={message}
          onToggleReaction={onToggleReaction}
          onOpenThread={onOpenThread}
          showThreadButton={showThreadButton}
          align="start"
        />
      ) : null}
    </article>
  );
}

"use client";

import { Bot, ChevronDown, ChevronUp } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { useStreamingContent } from "@/app/chat/hooks/use-streaming-content";
import { useStreamingPaused } from "@/app/chat/hooks/use-streaming-paused";
import { useTimeZone } from "@/app/chat/hooks/use-time-zone";
import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import { parseMarkdownWithDataImageSegments } from "@/app/chat/utils/generated-image-markdown";
import { extractOAuthAuthorizationUrl } from "@/app/chat/utils/oauth-link";
import { ChatGeneratedImageBubble } from "@/components/chat/chat-generated-image-bubble";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ChatOAuthAuthenticateCta } from "./chat-oauth-authenticate-cta";

interface MessageFilePart {
  type: "file";
  url: string;
  mediaType: string;
  filename?: string;
}

interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  fileParts?: MessageFilePart[];
  userImageUrl?: string;
  userName?: string;
  createdAt?: Date;
  coworkerName?: string;
  coworkerId?: string;
  coworkerImageUrl?: string | null;
  modelId?: string;
  modelName?: string;
  isStreaming?: boolean;
  leftAlignedUser?: boolean;
  showSenderHeader?: boolean;
}

function isImageFilePart(part: MessageFilePart): boolean {
  return part.mediaType.toLowerCase().startsWith("image/");
}

export default function ChatMessage({
  role,
  content,
  fileParts = [],
  userImageUrl,
  userName,
  createdAt,
  coworkerName,
  coworkerId,
  coworkerImageUrl,
  modelId,
  modelName,
  isStreaming = false,
  leftAlignedUser = false,
  showSenderHeader = false,
}: ChatMessageProps) {
  const t = useTranslations("App.Chat.Chat");
  const isUser = role === "user";
  const formatter = useFormatter();
  const isAssistantStreaming = !isUser && isStreaming;
  const displayContent = useStreamingContent(content, isAssistantStreaming);
  const isPaused = useStreamingPaused(content, isAssistantStreaming);
  const hasDisplayContent = displayContent.trim().length > 0;
  const hasFileParts = fileParts.length > 0;
  const isContentFullyDisplayed =
    content.trim().length > 0 && displayContent.length >= content.length;
  const showPausedProcessing =
    isAssistantStreaming && isPaused && !isContentFullyDisplayed;

  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [showPromptToggle, setShowPromptToggle] = useState(false);
  const userContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      !isUser ||
      leftAlignedUser ||
      isPromptExpanded ||
      !userContentRef.current
    ) {
      return;
    }
    const el = userContentRef.current;
    const overflow = el.scrollHeight > el.clientHeight;
    setShowPromptToggle(overflow);
  }, [isUser, leftAlignedUser, isPromptExpanded, displayContent]);

  // `null` on the server and first client render so SSR and hydration agree;
  // resolves to the client timezone after mount.
  const timeZone = useTimeZone();

  const timestamp =
    createdAt && timeZone
      ? formatter.dateTime(createdAt, {
          hour: "2-digit",
          minute: "2-digit",
          timeZone,
        })
      : null;

  const getAssistantAvatar = () => {
    if (modelId) {
      return (
        <ChatModelIcon
          modelId={modelId}
          modelName={modelName ?? t("modelAlt")}
          size={28}
          className="size-full p-0.5"
        />
      );
    }

    if (coworkerId) {
      const imageUrl = coworkerImageUrl ?? getCoworkerImageUrl(coworkerId);
      if (imageUrl) {
        return (
          <AvatarImage
            src={imageUrl}
            alt={coworkerName || t("coworkerAlt")}
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        );
      }
    }

    return (
      <AvatarFallback className="bg-primary text-primary-foreground">
        {coworkerName ? coworkerName.charAt(0).toUpperCase() : "A"}
      </AvatarFallback>
    );
  };

  const showStreamingDotsOnly = isAssistantStreaming && !hasDisplayContent;
  /**
   * OAuth URL must be read from full `content`, not `displayContent` (progressive
   * reveal). Otherwise the authorize CTA only appears after the reveal catches up.
   */
  const oauthAuthorizationUrl = isUser
    ? null
    : extractOAuthAuthorizationUrl(content);
  const assistantContentSegments = isUser
    ? []
    : parseMarkdownWithDataImageSegments(displayContent);
  const assistantImageFileParts = isUser
    ? []
    : fileParts.filter(isImageFilePart);
  const assistantOtherFileParts = isUser
    ? []
    : fileParts.filter((part) => !isImageFilePart(part));
  const shouldLeftAlignUser = isUser && leftAlignedUser;
  const senderName = isUser
    ? (userName ?? "You")
    : (coworkerName ?? modelName ?? t("assistant"));
  const showCoworkerIcon = !isUser && Boolean(coworkerName);

  const userAvatar = (
    <Avatar className="size-8 shrink-0">
      {userImageUrl ? (
        <AvatarImage
          src={userImageUrl}
          alt={userName ?? t("userAvatarAlt")}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <AvatarFallback className="bg-muted">
        {userName ? userName.charAt(0).toUpperCase() : "U"}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <div
      className={cn(
        "flex w-full gap-3 px-4",
        shouldLeftAlignUser
          ? "min-h-11 items-start justify-start py-1.5"
          : isUser
            ? "justify-end py-0.5"
            : "min-h-11 items-start justify-start py-1.5",
      )}
    >
      {!isUser && (
        <Avatar
          className={cn(
            "size-8 shrink-0 overflow-hidden rounded-full",
            modelId && "bg-white dark:bg-black",
          )}
        >
          {getAssistantAvatar()}
        </Avatar>
      )}
      {shouldLeftAlignUser ? userAvatar : null}
      <div
        className={cn(
          "flex w-full min-w-0",
          shouldLeftAlignUser
            ? "min-h-5 items-start justify-start"
            : isUser
              ? "items-end justify-end"
              : "min-h-5 items-start justify-start",
        )}
      >
        <div
          className={cn(
            "flex flex-col gap-0.5",
            shouldLeftAlignUser
              ? "max-w-full items-start"
              : isUser
                ? "max-w-[70%] items-end"
                : "max-w-full items-start",
          )}
        >
          {showSenderHeader ? (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-semibold">
                  {senderName}
                </span>
                {showCoworkerIcon ? (
                  <Bot
                    className="text-muted-foreground size-3.5 shrink-0"
                    aria-hidden
                  />
                ) : null}
              </span>
              {timestamp ? (
                <time className="text-muted-foreground text-xs">
                  {timestamp}
                </time>
              ) : null}
            </div>
          ) : null}
          {showStreamingDotsOnly ? (
            <div className="flex min-h-5 items-start pt-1">
              <span className="reasoning-text-shine text-sm leading-5">
                {t("reasoning.thinking")}
              </span>
            </div>
          ) : (
            <div
              className={cn(
                "rounded-lg",
                isUser && !shouldLeftAlignUser
                  ? "bg-muted-foreground/10 text-foreground min-h-6 px-3 py-3"
                  : "text-foreground min-h-5 bg-transparent pt-1 pr-10 pb-3",
              )}
            >
              <div
                className={cn(
                  "prose prose-sm dark:prose-invert max-w-none",

                  isAssistantStreaming && "contain-layout",
                  "[&>*:first-child]:mt-0",
                  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
                  "**:leading-relaxed",
                  "[&_h1]:text-base [&_h2]:text-base [&_h3]:text-base [&_h4]:text-base [&_h5]:text-base [&_h6]:text-base",
                  "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
                  "[&_strong]:font-semibold [&_strong]:text-inherit",
                  "[&_br]:block [&_br]:h-3",
                  isUser &&
                    !shouldLeftAlignUser &&
                    "prose-invert [&_strong]:text-primary-foreground",
                )}
                style={{ fontSize: "0.875rem" }}
              >
                {hasDisplayContent || hasFileParts ? (
                  isUser ? (
                    <>
                      {hasFileParts ? (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {fileParts.map((part) => (
                            <FileChipMiniPreviewWithMetadata
                              key={part.url}
                              url={part.url}
                              fileName={part.filename}
                              mediaType={part.mediaType}
                              sizeClass="size-24"
                            />
                          ))}
                        </div>
                      ) : null}
                      {hasDisplayContent ? (
                        <div
                          ref={userContentRef}
                          className={cn(
                            !shouldLeftAlignUser &&
                              !isPromptExpanded &&
                              "line-clamp-3",
                          )}
                        >
                          <Markdown>{displayContent}</Markdown>
                        </div>
                      ) : null}
                      {!shouldLeftAlignUser &&
                      (showPromptToggle || isPromptExpanded) ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              aria-label={
                                isPromptExpanded
                                  ? t("collapsePrompt")
                                  : t("expandPrompt")
                              }
                              className="text-muted-foreground hover:text-foreground mt-1 flex w-full justify-center rounded p-1 transition-colors"
                              onClick={() =>
                                setIsPromptExpanded((prev) => !prev)
                              }
                              type="button"
                            >
                              {isPromptExpanded ? (
                                <ChevronUp className="size-4" />
                              ) : (
                                <ChevronDown className="size-4" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            className="bg-popover text-popover-foreground border-border border"
                            hideArrow
                          >
                            {isPromptExpanded
                              ? t("collapsePrompt")
                              : t("expandPrompt")}
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {assistantContentSegments.map((segment, index) => {
                        if (segment.type === "text") {
                          if (segment.text.trim().length === 0) return null;
                          return (
                            <Markdown key={`text-${index}`}>
                              {segment.text}
                            </Markdown>
                          );
                        }

                        return (
                          <ChatGeneratedImageBubble
                            key={`image-${index}`}
                            alt={segment.alt}
                            downloadLabel={t("downloadGeneratedImage")}
                            src={
                              segment.type === "image" ? segment.src : undefined
                            }
                          />
                        );
                      })}
                      {hasFileParts ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {assistantImageFileParts.map((part) => (
                            <ChatGeneratedImageBubble
                              key={part.url}
                              alt={part.filename ?? t("downloadGeneratedImage")}
                              downloadLabel={t("downloadGeneratedImage")}
                              src={part.url}
                            />
                          ))}
                          {assistantOtherFileParts.map((part) => (
                            <FileChipMiniPreviewWithMetadata
                              key={part.url}
                              url={part.url}
                              fileName={part.filename}
                              mediaType={part.mediaType}
                              sizeClass="size-20"
                            />
                          ))}
                        </div>
                      ) : null}
                    </>
                  )
                ) : isAssistantStreaming ? (
                  <span className="reasoning-text-shine text-sm leading-5">
                    {t("reasoning.thinking")}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">
                    {isUser ? "(Empty message)" : t("noResponseConnectionLost")}
                  </span>
                )}
              </div>
              {oauthAuthorizationUrl ? (
                <ChatOAuthAuthenticateCta
                  href={oauthAuthorizationUrl}
                  label={t("authorize")}
                />
              ) : null}
              {showPausedProcessing && (
                <div className="mt-2">
                  <span className="reasoning-text-shine text-sm">
                    {t("reasoning.processing")}
                  </span>
                </div>
              )}
            </div>
          )}
          {timestamp &&
            !showSenderHeader &&
            (isUser ||
              (!isAssistantStreaming &&
                content.length > 0 &&
                displayContent.length === content.length)) && (
              <div
                className={cn(
                  "text-muted-foreground text-xs",
                  isUser ? "text-right" : "text-left",
                )}
              >
                {timestamp}
              </div>
            )}
        </div>
      </div>
      {isUser && !shouldLeftAlignUser ? userAvatar : null}
    </div>
  );
}

"use client";

import { useFormatter, useTranslations } from "next-intl";

import { useStreamingContent } from "@/app/chat/hooks/use-streaming-content";
import { useStreamingPaused } from "@/app/chat/hooks/use-streaming-paused";
import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import { extractOAuthAuthorizationUrl } from "@/app/chat/utils/oauth-link";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { ChatOAuthAuthenticateCta } from "./chat-oauth-authenticate-cta";

interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  userImageUrl?: string;
  userName?: string;
  createdAt?: Date;
  coworkerName?: string;
  coworkerId?: string;
  coworkerImageUrl?: string | null;
  modelId?: string;
  modelName?: string;
  isStreaming?: boolean;
}

export default function ChatMessage({
  role,
  content,
  userImageUrl,
  userName,
  createdAt,
  coworkerName,
  coworkerId,
  coworkerImageUrl,
  modelId,
  modelName,
  isStreaming = false,
}: ChatMessageProps) {
  const t = useTranslations("App.Chat.Chat");
  const isUser = role === "user";
  const formatter = useFormatter();
  const isAssistantStreaming = !isUser && isStreaming;
  const displayContent = useStreamingContent(content, isAssistantStreaming);
  const isPaused = useStreamingPaused(content, isAssistantStreaming);

  const timestamp = createdAt
    ? formatter.dateTime(createdAt, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
    : null;

  // Get avatar content for assistant messages
  const getAssistantAvatar = () => {
    // If it's a model conversation, show model logo
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

    // If it's a coworker conversation, show coworker image
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

    // Default fallback
    return (
      <AvatarFallback className="bg-primary text-primary-foreground">
        {coworkerName ? coworkerName.charAt(0).toUpperCase() : "A"}
      </AvatarFallback>
    );
  };

  const showStreamingDotsOnly =
    isAssistantStreaming && !(displayContent && displayContent.trim());
  const oauthAuthorizationUrl = isUser
    ? null
    : extractOAuthAuthorizationUrl(displayContent);

  return (
    <div
      className={cn(
        "flex w-full gap-3 px-4",
        isUser
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
      <div
        className={cn(
          "flex w-full min-w-0",
          isUser
            ? "items-end justify-end"
            : "min-h-5 items-start justify-start",
        )}
      >
        <div
          className={cn(
            "flex flex-col gap-0.5",
            isUser ? "max-w-[70%] items-end" : "max-w-full items-start",
          )}
        >
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
                isUser
                  ? "bg-muted-foreground/10 text-foreground min-h-6 px-3 py-3"
                  : "text-foreground min-h-5 bg-transparent pt-1 pr-10 pb-3",
              )}
            >
              <div
                className={cn(
                  "prose prose-sm dark:prose-invert max-w-none",

                  isAssistantStreaming && "contain-layout",
                  // Align first line with dots state: no top margin on first element
                  "[&>*:first-child]:mt-0",
                  // Allow proper spacing for paragraphs and line breaks
                  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
                  // Ensure proper line height for readability
                  "**:leading-relaxed",
                  // Prevent headings from being too large (keep them as regular text size)
                  "[&_h1]:text-base [&_h2]:text-base [&_h3]:text-base [&_h4]:text-base [&_h5]:text-base [&_h6]:text-base",
                  "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
                  // Ensure bold text stays as bold, not headings
                  "[&_strong]:font-semibold [&_strong]:text-inherit",
                  // Proper spacing for line breaks
                  "[&_br]:block [&_br]:h-3",
                  isUser && "prose-invert [&_strong]:text-primary-foreground",
                )}
                style={{ fontSize: "0.875rem" }}
              >
                {displayContent && displayContent.trim() ? (
                  <Markdown>{displayContent}</Markdown>
                ) : isAssistantStreaming ? (
                  <span className="reasoning-text-shine text-sm leading-5">
                    {t("reasoning.thinking")}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">
                    {isUser ? "(Empty message)" : "(No response yet)"}
                  </span>
                )}
              </div>
              {oauthAuthorizationUrl ? (
                <ChatOAuthAuthenticateCta
                  href={oauthAuthorizationUrl}
                  label={t("authorize")}
                />
              ) : null}
              {isAssistantStreaming && isPaused && (
                <div className="mt-2">
                  <span className="reasoning-text-shine text-sm">
                    {t("reasoning.processing")}
                  </span>
                </div>
              )}
            </div>
          )}
          {timestamp &&
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
      {isUser && (
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
      )}
    </div>
  );
}

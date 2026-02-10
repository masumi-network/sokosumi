"use client";

import { useFormatter, useTranslations } from "next-intl";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import { getModelImageUrl } from "@/app/chat/utils/model-utils";
import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  userImageUrl?: string;
  userName?: string;
  createdAt?: Date;
  coworkerName?: string;
  coworkerId?: string;
  modelId?: string;
  modelName?: string;
}

export default function ChatMessage({
  role,
  content,
  userImageUrl,
  userName,
  createdAt,
  coworkerName,
  coworkerId,
  modelId,
  modelName,
}: ChatMessageProps) {
  const t = useTranslations("App.Chat.Chat");
  const isUser = role === "user";
  const formatter = useFormatter();

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
      const modelImageUrls = getModelImageUrl(modelId);
      if (modelImageUrls) {
        return (
          <>
            <img
              src={modelImageUrls.light}
              alt={modelName || t("modelAlt")}
              className="block size-full object-contain p-0.5 dark:hidden"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <img
              src={modelImageUrls.dark}
              alt={modelName || t("modelAlt")}
              className="hidden size-full object-contain p-0.5 dark:block"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </>
        );
      }
      // Fallback to model name initial
      return (
        <AvatarFallback className="bg-primary text-primary-foreground">
          {modelName ? modelName.charAt(0).toUpperCase() : "M"}
        </AvatarFallback>
      );
    }

    // If it's a coworker conversation, show coworker image
    if (coworkerId) {
      const imageUrl = getCoworkerImageUrl(coworkerId);
      if (imageUrl) {
        return (
          <AvatarImage
            src={imageUrl}
            alt={coworkerName || t("coworkerAlt")}
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

  return (
    <div
      className={cn(
        "flex w-full gap-3 px-4 py-0.5",
        isUser ? "justify-end" : "justify-start",
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
          "flex w-full",
          isUser ? "items-end justify-end" : "items-start justify-start",
        )}
      >
        <div
          className={cn(
            "flex max-w-[50%] flex-col gap-0.5",
            isUser ? "items-end" : "items-start",
          )}
        >
          <div
            className={cn(
              "min-h-[1.5rem] rounded-lg px-3",
              isUser
                ? "bg-gray-200 py-3 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                : "text-foreground bg-transparent pb-3",
            )}
          >
            <div
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none",
                // Allow proper spacing for paragraphs and line breaks
                "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
                // Ensure proper line height for readability
                "[&_*]:leading-relaxed",
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
              {content && content.trim() ? (
                <Markdown>{content}</Markdown>
              ) : (
                <span className="text-muted-foreground italic">
                  {isUser ? "(Empty message)" : "(No response yet)"}
                </span>
              )}
            </div>
          </div>
          {timestamp && (
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

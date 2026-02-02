"use client";

import { useFormatter } from "next-intl";

import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  userImageUrl?: string;
  userName?: string;
  createdAt?: Date;
  coworkerName?: string;
  coworkerId?: string;
}

export default function ChatMessage({
  role,
  content,
  userImageUrl,
  userName,
  createdAt,
  coworkerName,
  coworkerId,
}: ChatMessageProps) {
  const isUser = role === "user";
  const formatter = useFormatter();

  const timestamp = createdAt
    ? formatter.dateTime(createdAt, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
    : null;

  return (
    <div
      className={cn(
        "flex w-full gap-3 px-4 py-0.5",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <Avatar className="size-8 shrink-0">
          {coworkerId &&
            (() => {
              const imageMap: Record<string, string> = {
                hannah: "/images/coworkers/hannah.png",
                demosthenes: "/images/coworkers/demosthenes.png",
              };
              const imageUrl = imageMap[coworkerId];
              return imageUrl ? (
                <AvatarImage
                  src={imageUrl}
                  alt={coworkerName || "Coworker"}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : null;
            })()}
          <AvatarFallback className="bg-primary text-primary-foreground">
            {coworkerName ? coworkerName.charAt(0).toUpperCase() : "A"}
          </AvatarFallback>
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
              "min-h-[1.5rem] rounded-lg px-3 py-3",
              isUser
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
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
              alt={userName ?? "User avatar"}
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

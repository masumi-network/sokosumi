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
}

export default function ChatMessage({
  role,
  content,
  userImageUrl,
  userName,
  createdAt,
  coworkerName,
}: ChatMessageProps) {
  const isUser = role === "user";
  const formatter = useFormatter();

  const timestamp = createdAt
    ? formatter.dateTime(createdAt, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-0",
        isUser ? "justify-end" : "bg-card",
        !isUser && "bg-card",
      )}
    >
      {!isUser && (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-primary text-primary-foreground">
            {coworkerName ? coworkerName.charAt(0).toUpperCase() : "A"}
          </AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn(
          "min-w-0 flex-1",
          isUser
            ? "flex items-end justify-end"
            : "flex items-start justify-start",
        )}
      >
        <div
          className={cn(
            "flex max-w-[80%] flex-col gap-0.5",
            isUser ? "items-end" : "items-start",
          )}
        >
          <div
            className={cn(
              "rounded-lg px-3 py-3 min-h-[1.5rem]",
              isUser
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            <div
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none [&_*]:!leading-none [&_*]:leading-none [&>*]:my-0 [&>p]:my-0 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&_*]:!m-0",
                isUser && "prose-invert **:text-primary-foreground",
              )}
              style={{ lineHeight: "1.1", fontSize: "0.875rem" }}
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

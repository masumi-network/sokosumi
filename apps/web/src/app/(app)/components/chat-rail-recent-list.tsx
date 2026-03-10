"use client";

import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { buildChatGroups, type ChatGroup } from "@/app/chat/utils/chat-groups";
import type { Coworker } from "@/app/chat/utils/types";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/lib/actions/conversation";
import { cn } from "@/lib/utils";

interface ChatRailRecentListProps {
  conversations: Conversation[];
  coworkers: Coworker[];
  selectedConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
}

export default function ChatRailRecentList({
  conversations,
  coworkers,
  selectedConversationId,
  onSelectConversation,
}: ChatRailRecentListProps) {
  const t = useTranslations("App.Sidebar.Content.ChatLists");
  const chatGroups = useMemo(
    () =>
      buildChatGroups(
        conversations,
        t("untitledChat", { default: "Untitled Chat" }),
      ),
    [conversations, t],
  );

  if (chatGroups.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-border flex items-center gap-2 border-b px-4 py-3">
          <MessageSquare className="text-muted-foreground size-4" aria-hidden />
          <span className="text-sm font-medium">
            {t("title", { default: "Recent Chats" })}
          </span>
        </div>
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-6 text-center text-sm">
          {t("noChats", { default: "No chats yet" })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <MessageSquare className="text-muted-foreground size-4" aria-hidden />
        <span className="text-sm font-medium">
          {t("title", { default: "Recent Chats" })}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {chatGroups.map((group) => {
          const mostRecentConversation = group.conversations[0];
          const isActive =
            selectedConversationId === mostRecentConversation?.id;

          return (
            <Button
              key={group.key}
              type="button"
              variant="ghost"
              className={cn(
                "h-auto w-full justify-start px-3 py-2",
                isActive && "bg-muted",
              )}
              onClick={() => {
                if (mostRecentConversation) {
                  onSelectConversation(mostRecentConversation.id);
                }
              }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <GroupAvatar
                  group={group}
                  coworkers={coworkers}
                  t={t}
                  isActive={isActive}
                />
                <span className="truncate text-sm">{group.displayName}</span>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

interface GroupAvatarProps {
  group: ChatGroup;
  coworkers: Coworker[];
  t: (key: string, opts?: { default?: string }) => string;
  isActive: boolean;
}

function GroupAvatar({ group, coworkers, t, isActive }: GroupAvatarProps) {
  const { modelId, modelName, coworkerId, coworkerName } = group;

  return (
    <Avatar className="size-6 shrink-0 overflow-hidden rounded-full">
      {modelId ? (
        <ChatModelIcon
          modelId={modelId}
          modelName={modelName ?? t("modelAlt")}
          size={20}
          className="size-full p-0.5"
        />
      ) : coworkerId ? (
        (() => {
          const coworkerFromList = coworkers.find(
            (coworker) =>
              coworker.id === coworkerId || coworker.slug === coworkerId,
          );
          const avatarUrl = coworkerFromList?.avatar ?? null;

          return (
            <>
              {avatarUrl ? (
                <AvatarImage
                  src={avatarUrl}
                  alt={coworkerName ?? coworkerId}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback
                className={cn(
                  "bg-primary text-primary-foreground text-xs",
                  isActive && "bg-primary-foreground text-primary",
                )}
              >
                {coworkerName
                  ? coworkerName.charAt(0).toUpperCase()
                  : coworkerId.charAt(0).toUpperCase()}
              </AvatarFallback>
            </>
          );
        })()
      ) : (
        <AvatarFallback
          className={cn(
            "bg-primary text-primary-foreground text-xs",
            isActive && "bg-primary-foreground text-primary",
          )}
        >
          {coworkerName
            ? coworkerName.charAt(0)
            : modelName
              ? modelName.charAt(0).toUpperCase()
              : "C"}
        </AvatarFallback>
      )}
    </Avatar>
  );
}

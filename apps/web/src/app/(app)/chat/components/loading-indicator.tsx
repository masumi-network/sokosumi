"use client";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import type { Chat } from "@/app/chat/utils/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface LoadingIndicatorProps {
  selectedChatId: string | null;
  chats: Chat[];
}

export default function LoadingIndicator({
  selectedChatId,
  chats,
}: LoadingIndicatorProps) {
  const selectedChat = chats.find((c) => c.id === selectedChatId);
  const coworkerId = selectedChat?.coworker?.id;
  const imageUrl = coworkerId ? getCoworkerImageUrl(coworkerId) : null;

  return (
    <div className="flex gap-3 px-4 py-0">
      <Avatar className="size-8 shrink-0">
        {imageUrl ? (
          <AvatarImage
            src={imageUrl}
            alt={selectedChat?.coworker?.name || "Coworker"}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}
        <AvatarFallback className="bg-primary text-primary-foreground">
          {selectedChat?.coworker?.name
            ? selectedChat.coworker.name.charAt(0).toUpperCase()
            : "A"}
        </AvatarFallback>
      </Avatar>
      <div className="flex items-center">
        <div className="flex gap-1">
          <div className="bg-muted h-2 w-2 animate-pulse rounded-full" />
          <div className="bg-muted h-2 w-2 animate-pulse rounded-full delay-75" />
          <div className="bg-muted h-2 w-2 animate-pulse rounded-full delay-150" />
        </div>
      </div>
    </div>
  );
}

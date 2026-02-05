"use client";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import { getModelImageUrl } from "@/app/chat/utils/model-utils";
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
  const modelId = selectedChat?.model?.id;
  const modelName = selectedChat?.model?.name;
  const coworkerName = selectedChat?.coworker?.name;

  // Get avatar content
  const getAvatarContent = () => {
    // If it's a model conversation, show model logo
    if (modelId) {
      const modelImageUrls = getModelImageUrl(modelId);
      if (modelImageUrls) {
        return (
          <>
            <img
              src={modelImageUrls.light}
              alt={modelName || "Model"}
              className="block size-full object-contain p-0.5 dark:hidden"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <img
              src={modelImageUrls.dark}
              alt={modelName || "Model"}
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
            alt={coworkerName || "Coworker"}
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
        {coworkerName
          ? coworkerName.charAt(0).toUpperCase()
          : modelName
            ? modelName.charAt(0).toUpperCase()
            : "A"}
      </AvatarFallback>
    );
  };

  return (
    <div className="flex gap-3 px-4 py-0">
      <Avatar
        className={`size-8 shrink-0 overflow-hidden rounded-full ${
          modelId ? "bg-white dark:bg-black" : ""
        }`}
      >
        {getAvatarContent()}
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

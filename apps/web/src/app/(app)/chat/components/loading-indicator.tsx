"use client";

import { useTranslations } from "next-intl";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface LoadingIndicatorProps {
  selectedChatId: string | null;
  chats: Chat[];
  coworkers?: Coworker[];
}

export default function LoadingIndicator({
  selectedChatId,
  chats,
  coworkers = [],
}: LoadingIndicatorProps) {
  const t = useTranslations("App.Chat.Chat");
  const selectedChat = chats.find((c) => c.id === selectedChatId);
  const coworkerId = selectedChat?.coworker?.id;
  const coworkerFromList = coworkerId
    ? coworkers.find((c) => c.id === coworkerId)
    : undefined;
  const coworkerImageUrl =
    selectedChat?.coworker?.avatar ?? coworkerFromList?.avatar;
  const modelId = selectedChat?.model?.id;
  const modelName = selectedChat?.model?.name;
  const coworkerName = selectedChat?.coworker?.name;

  // Get avatar content
  const getAvatarContent = () => {
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
        {coworkerName
          ? coworkerName.charAt(0).toUpperCase()
          : modelName
            ? modelName.charAt(0).toUpperCase()
            : "A"}
      </AvatarFallback>
    );
  };

  return (
    <div className="flex min-h-11 items-start gap-3 px-4 py-1.5">
      <Avatar
        className={`size-8 shrink-0 overflow-hidden rounded-full ${
          modelId ? "bg-white dark:bg-black" : ""
        }`}
      >
        {getAvatarContent()}
      </Avatar>
      <div className="flex min-h-5 items-start pt-1">
        <span className="reasoning-text-shine text-sm leading-5">
          {t("reasoning.thinking")}
        </span>
      </div>
    </div>
  );
}

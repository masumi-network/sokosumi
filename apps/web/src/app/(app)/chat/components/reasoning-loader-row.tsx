"use client";

import { useTranslations } from "next-intl";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface ReasoningLoaderRowProps {
  message: string;
  selectedChatId: string | null;
  chats: Chat[];
  coworkers?: Coworker[];
}

const REASONING_MESSAGE_KEYS: Record<
  string,
  "processing" | "thinking" | "searchingFiles" | "callingTools"
> = {
  "Processing...": "processing",
  "Thinking...": "thinking",
  "Searching files...": "searchingFiles",
  "Calling tools...": "callingTools",
};

export default function ReasoningLoaderRow({
  message,
  selectedChatId,
  chats,
  coworkers = [],
}: ReasoningLoaderRowProps) {
  const t = useTranslations("App.Chat.Chat");
  const key = REASONING_MESSAGE_KEYS[message];
  const displayMessage = key ? t(`reasoning.${key}`) : message;
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

  function getAvatarContent() {
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
        {coworkerName
          ? coworkerName.charAt(0).toUpperCase()
          : modelName
            ? modelName.charAt(0).toUpperCase()
            : "A"}
      </AvatarFallback>
    );
  }

  return (
    <div className="flex min-h-11 items-start gap-3 px-4 py-1.5">
      <Avatar
        className={`size-8 shrink-0 overflow-hidden rounded-full ${
          modelId ? "bg-white dark:bg-black" : ""
        }`}
      >
        {getAvatarContent()}
      </Avatar>
      <div className="flex min-h-5 min-w-0 flex-1 items-start pt-1">
        <span className="reasoning-text-shine text-sm leading-5">
          {displayMessage}
        </span>
      </div>
    </div>
  );
}

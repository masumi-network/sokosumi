"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import { getModelImageUrl } from "@/app/chat/utils/model-utils";
import type { Chat, Coworker } from "@/app/chat/utils/types";
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
      const modelImageUrls = getModelImageUrl(modelId);
      if (modelImageUrls) {
        const alt = modelName || t("modelAlt");
        return (
          <>
            <Image
              src={modelImageUrls.light}
              alt={alt}
              width={32}
              height={32}
              className="block size-full object-contain p-0.5 dark:hidden"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <Image
              src={modelImageUrls.dark}
              alt={alt}
              width={32}
              height={32}
              className="hidden size-full object-contain p-0.5 dark:block"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </>
        );
      }
      return (
        <AvatarFallback className="bg-primary text-primary-foreground">
          {modelName ? modelName.charAt(0).toUpperCase() : "M"}
        </AvatarFallback>
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
    <div className="flex gap-3 px-4 py-1.5">
      <Avatar
        className={`size-8 shrink-0 overflow-hidden rounded-full ${
          modelId ? "bg-white dark:bg-black" : ""
        }`}
      >
        {getAvatarContent()}
      </Avatar>
      <div className="flex min-w-0 flex-1 items-center">
        <span className="reasoning-text-shine text-sm">{displayMessage}</span>
      </div>
    </div>
  );
}

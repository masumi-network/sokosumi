"use client";

import { useTranslations } from "next-intl";

import type { Chat, Coworker } from "@/app/chat/utils/types";

import { AssistantAvatar } from "./assistant-avatar";

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

  return (
    <div className="flex gap-3 px-4 py-1.5">
      <AssistantAvatar
        modelId={modelId}
        modelName={modelName}
        coworkerId={coworkerId}
        coworkerImageUrl={coworkerImageUrl}
        coworkerName={coworkerName}
        modelAltText={t("modelAlt")}
        coworkerAltText={t("coworkerAlt")}
      />
      <div className="flex min-w-0 flex-1 items-center">
        <span className="reasoning-text-shine text-sm">{displayMessage}</span>
      </div>
    </div>
  );
}

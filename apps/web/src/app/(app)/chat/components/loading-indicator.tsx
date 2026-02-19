"use client";

import { useTranslations } from "next-intl";

import type { Chat, Coworker } from "@/app/chat/utils/types";

import { AssistantAvatar } from "./assistant-avatar";

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

  return (
    <div className="flex gap-3 px-4 py-0">
      <AssistantAvatar
        modelId={modelId}
        modelName={modelName}
        coworkerId={coworkerId}
        coworkerImageUrl={coworkerImageUrl}
        coworkerName={coworkerName}
        modelAltText={t("modelAlt")}
        coworkerAltText={t("coworkerAlt")}
      />
      <div className="flex items-center">
        <div className="flex gap-1">
          <div className="bg-muted-foreground/70 h-2 w-2 animate-pulse rounded-full" />
          <div className="bg-muted-foreground/70 h-2 w-2 animate-pulse rounded-full delay-75" />
          <div className="bg-muted-foreground/70 h-2 w-2 animate-pulse rounded-full delay-150" />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import { isReasoningGenericLabel } from "@/app/chat-ui/utils/reasoning-generic-labels";

import ReasoningLoaderRow from "./reasoning-loader-row";

interface ReasoningLoadersProps {
  reasoningMessages: Array<{ id: string; message: string }>;
  selectedChatId: string | null;
  chats: Chat[];
  coworkers?: Coworker[];
}

export default function ReasoningLoaders({
  reasoningMessages,
  selectedChatId,
  chats,
  coworkers = [],
}: ReasoningLoadersProps) {
  const t = useTranslations("App.Chat.Chat");
  if (reasoningMessages.length === 0) return null;

  const onlyProcessing =
    reasoningMessages.length === 1 &&
    reasoningMessages[0].message === "Processing...";
  const loaderLabel = onlyProcessing
    ? t("reasoning.processing")
    : t("reasoning.thinking");

  const subordinateSteps = reasoningMessages
    .filter(({ message }) => !isReasoningGenericLabel(message))
    .map(({ message }) => message.trim())
    .filter(Boolean);

  return (
    <ReasoningLoaderRow
      loaderLabel={loaderLabel}
      subordinateSteps={subordinateSteps}
      selectedChatId={selectedChatId}
      chats={chats}
      coworkers={coworkers}
    />
  );
}

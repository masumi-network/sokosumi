"use client";

import { useTranslations } from "next-intl";
import ReasoningLoaderRow from "@/app/chat/components/reasoning-loader-row";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import { getReasoningStepDisplayText } from "@/app/new-chat-ui/utils/reasoning-generic-labels";

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

  const firstReasoning = reasoningMessages[0]?.message ?? "";
  const onlyProcessing =
    reasoningMessages.length === 1 &&
    getReasoningStepDisplayText(firstReasoning) === null &&
    firstReasoning.trim() === "Processing...";
  const loaderLabel = onlyProcessing
    ? t("reasoning.processing")
    : t("reasoning.thinking");

  const subordinateSteps = reasoningMessages
    .map(({ message }) => getReasoningStepDisplayText(message))
    .filter((s): s is string => Boolean(s));

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

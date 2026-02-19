"use client";

import type { Chat, Coworker } from "@/app/chat/utils/types";

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
  if (reasoningMessages.length === 0) return null;

  const latest = reasoningMessages[reasoningMessages.length - 1];
  return (
    <div className="flex flex-col gap-0">
      <ReasoningLoaderRow
        key={latest.id}
        message={latest.message}
        selectedChatId={selectedChatId}
        chats={chats}
        coworkers={coworkers}
      />
    </div>
  );
}

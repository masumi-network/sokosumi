"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import type { Chat } from "@/app/chat/utils/types";

interface UseChatPreviewProps {
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
}

/**
 * Hook to update chat title when the first assistant message is received (e.g. "New chat" -> snippet).
 */
export function useChatPreview({ setChats }: UseChatPreviewProps) {
  const t = useTranslations("App.Chat.Chat");

  const updateChatPreview = useCallback(
    (chatId: string, content: string, isFirstMessage = false) => {
      if (!content?.trim() || !isFirstMessage) {
        return;
      }

      const now = new Date();
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                title: content.slice(0, 50) || t("newChat"),
                updatedAt: now,
                status: "active",
              }
            : chat,
        ),
      );
    },
    [setChats, t],
  );

  return { updateChatPreview };
}

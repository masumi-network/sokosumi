"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import type { Chat, Coworker } from "@/app/chat/utils/types";
import type { Conversation } from "@/lib/actions/conversation";

interface UseChatSyncProps {
  conversations: Conversation[];
  chats: Chat[];
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
  selectedChatId: string | null;
  setSelectedModel: (model: { id: string; name: string } | null) => void;
  selectedModelRef: React.MutableRefObject<{ id: string; name: string } | null>;
  coworkers?: Coworker[];
}

/**
 * Hook to sync conversations from DB to local chats state
 */
export function useChatSync({
  conversations,
  chats,
  setChats,
  selectedChatId,
  setSelectedModel,
  selectedModelRef,
  coworkers = [],
}: UseChatSyncProps) {
  const t = useTranslations("App.Chat.Chat");

  // Sync conversations from DB to chats state
  useEffect(() => {
    if (conversations.length === 0 && chats.length === 0) {
      return; // Don't clear chats if conversations haven't loaded yet
    }

    requestAnimationFrame(() => {
      // Update selected model from conversations (does not depend on chats)
      for (const conv of conversations) {
        const metadata = conv.metadata as Record<string, unknown> | null;
        const modelId = metadata?.model_id as string | undefined;
        const modelName = metadata?.model_name as string | undefined;
        const conversationType = metadata?.type as string | undefined;
        if (
          conversationType === "model" &&
          modelId &&
          modelName &&
          conv.id === selectedChatId
        ) {
          setSelectedModel({ id: modelId, name: modelName });
          selectedModelRef.current = { id: modelId, name: modelName };
          break;
        }
        if (conversationType === "coworker" && conv.id === selectedChatId) {
          setSelectedModel(null);
          selectedModelRef.current = null;
          break;
        }
      }

      // Use functional update so we read latest chats and don't overwrite concurrent updates (e.g. from useChatPreview)
      setChats((latestChats) => {
        const mappedChats: Chat[] = conversations.map((conv: Conversation) => {
          const metadata = conv.metadata as Record<string, unknown> | null;
          const coworkerId = metadata?.coworker_id as string | undefined;
          const coworkerName = metadata?.coworker_name as string | undefined;
          const coworkerDescription = metadata?.coworker_description as
            | string
            | undefined;
          const coworkerUseCase = metadata?.coworker_useCase as
            | string
            | undefined;
          const modelId = metadata?.model_id as string | undefined;
          const modelName = metadata?.model_name as string | undefined;
          const conversationType = metadata?.type as string | undefined;

          const existingChat = latestChats.find((c) => c.id === conv.id);

          let coworker: Coworker | undefined;
          if (coworkerId && conversationType === "coworker") {
            const fromList =
              coworkers.find((c) => c.id === coworkerId) ??
              coworkers.find((c) => c.slug === coworkerId);
            if (fromList) {
              coworker = fromList;
            } else if (existingChat?.coworker) {
              coworker = existingChat.coworker;
            } else if (coworkerName) {
              coworker = {
                id: coworkerId,
                name: coworkerName,
                description: coworkerDescription || "",
                useCase: coworkerUseCase || "",
              };
            }
          } else if (existingChat?.coworker) {
            coworker = existingChat.coworker;
          }

          // Build model object from metadata or existing chat
          let model: { id: string; name: string } | undefined;
          if (existingChat?.model) {
            model = existingChat.model;
          } else if (conversationType === "model" && modelId && modelName) {
            model = { id: modelId, name: modelName };
          }

          return {
            id: conv.id,
            title:
              (existingChat?.title ?? conv.title) ||
              coworkerName ||
              modelName ||
              t("newChat"),
            createdAt: new Date(conv.createdAt),
            updatedAt: existingChat?.updatedAt ?? new Date(conv.updatedAt),
            status: (existingChat?.status || "active") as Chat["status"],
            coworker,
            model,
          };
        });

        const needsUpdate =
          mappedChats.length !== latestChats.length ||
          mappedChats.some(
            (chat, index) =>
              chat.id !== latestChats[index]?.id ||
              chat.updatedAt.getTime() !==
                latestChats[index]?.updatedAt.getTime(),
          );

        return needsUpdate ? mappedChats : latestChats;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, coworkers, t]);
}

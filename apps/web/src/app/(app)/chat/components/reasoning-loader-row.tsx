"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import type { Chat, Coworker } from "@/app/chat/utils/types";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { ReasoningStepText } from "./reasoning-step-text";

interface ReasoningLoaderRowProps {
  loaderLabel: string;
  subordinateSteps: string[];
  selectedChatId: string | null;
  chats: Chat[];
  coworkers?: Coworker[];
}

export default function ReasoningLoaderRow({
  loaderLabel,
  subordinateSteps,
  selectedChatId,
  chats,
  coworkers = [],
}: ReasoningLoaderRowProps) {
  const t = useTranslations("App.Chat.Chat");
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [subordinateSteps]);

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
    <div className="flex flex-col">
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
            {loaderLabel}
          </span>
        </div>
      </div>
      {subordinateSteps.length > 0 && (
        <div className="min-w-0 pt-0.5 pr-4 pb-1.5 pl-4">
          <div
            ref={viewportRef}
            className="reasoning-steps-viewport ml-11 max-h-[3.75rem] overflow-x-hidden overflow-y-auto"
            style={{ scrollBehavior: "smooth" }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {subordinateSteps.map((step, index) => (
                <p
                  key={index}
                  className="reasoning-step-in text-muted-foreground text-sm leading-5 break-words whitespace-pre-wrap"
                >
                  <ReasoningStepText text={step} />
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

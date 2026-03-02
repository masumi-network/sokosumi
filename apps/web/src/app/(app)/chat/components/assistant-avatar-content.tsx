"use client";

import { useTranslations } from "next-intl";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
import { AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface AssistantAvatarContentProps {
  modelId?: string;
  modelName?: string;
  coworkerId?: string;
  coworkerName?: string;
  coworkerImageUrl?: string | null;
}

export function AssistantAvatarContent({
  modelId,
  modelName,
  coworkerId,
  coworkerName,
  coworkerImageUrl,
}: AssistantAvatarContentProps) {
  const t = useTranslations("App.Chat.Chat");

  // If it's a model conversation, show model logo.
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

  // If it's a coworker conversation, show coworker image.
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

  // Default fallback.
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

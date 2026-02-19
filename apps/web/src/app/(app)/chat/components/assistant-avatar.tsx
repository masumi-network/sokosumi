"use client";

import Image from "next/image";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import { getModelImageUrl } from "@/app/chat/utils/model-utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface AssistantAvatarProps {
  modelId?: string | null;
  modelName?: string | null;
  coworkerId?: string | null;
  coworkerImageUrl?: string | null;
  coworkerName?: string | null;
  modelAltText?: string;
  coworkerAltText?: string;
}

export function AssistantAvatar({
  modelId,
  modelName,
  coworkerId,
  coworkerImageUrl,
  coworkerName,
  modelAltText = "Model",
  coworkerAltText = "Coworker",
}: AssistantAvatarProps) {
  const avatarContent = getAvatarContent({
    modelId,
    modelName,
    coworkerId,
    coworkerImageUrl,
    coworkerName,
    modelAltText,
    coworkerAltText,
  });

  return (
    <Avatar
      className={`size-8 shrink-0 overflow-hidden rounded-full ${
        modelId ? "bg-white dark:bg-black" : ""
      }`}
    >
      {avatarContent}
    </Avatar>
  );
}

function getAvatarContent({
  modelId,
  modelName,
  coworkerId,
  coworkerImageUrl,
  coworkerName,
  modelAltText,
  coworkerAltText,
}: AssistantAvatarProps) {
  if (modelId) {
    const modelImageUrls = getModelImageUrl(modelId);
    if (modelImageUrls) {
      const alt = modelName || modelAltText;
      return (
        <>
          <Image
            src={modelImageUrls.light}
            alt={alt ?? "Model"}
            width={32}
            height={32}
            className="block size-full object-contain p-0.5 dark:hidden"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <Image
            src={modelImageUrls.dark}
            alt={alt ?? "Model"}
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
          alt={coworkerName || coworkerAltText || "Coworker"}
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

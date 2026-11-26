"use client";

import type { AvatarState } from "@sokosumi/soko-bot";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { BotFace } from "@/components/soko-bot/bot-face";

interface BotProfileAvatarProps {
  name: string;
  seed: string;
  imageUrl: string | null;
  avatarCode?: string | null;
  avatarState?: AvatarState;
  /** Opens the picture picker; null when the viewer cannot change it. */
  onEdit: (() => void) | null;
}

/** The bot's picture beside its console's name, or its orb without one. */
export function BotProfileAvatar({
  name,
  seed,
  imageUrl,
  avatarCode,
  avatarState,
  onEdit,
}: BotProfileAvatarProps) {
  const t = useTranslations("App.SokoBot.Avatar");
  return (
    <div className="relative size-14 shrink-0 md:size-16">
      <div className="bg-muted ring-border size-full overflow-hidden rounded-full ring-2">
        <BotFace
          imageUrl={imageUrl}
          seed={seed}
          orbSize={128}
          avatarCode={avatarCode}
          avatarState={avatarState}
          avatarSize={64}
          interactive
          alt={name}
          className="size-full"
        />
      </div>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("edit")}
          className="bg-background border-border hover:bg-accent focus-visible:ring-ring absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full border outline-none focus-visible:ring-2"
        >
          <Pencil aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

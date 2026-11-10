"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { BotFace } from "@/components/soko-bot/bot-face";

interface BotProfileAvatarProps {
  name: string;
  seed: string;
  imageUrl: string | null;
  /** Opens the picture picker; null when the viewer cannot change it. */
  onEdit: (() => void) | null;
}

/** The bot's one picture at the top of its console, or its orb without one. */
export function BotProfileAvatar({
  name,
  seed,
  imageUrl,
  onEdit,
}: BotProfileAvatarProps) {
  const t = useTranslations("App.SokoBot.Avatar");
  return (
    <div className="relative size-38 shrink-0 md:size-46">
      <div className="bg-muted ring-border size-full overflow-hidden rounded-full ring-4">
        <BotFace
          imageUrl={imageUrl}
          seed={seed}
          orbSize={368}
          alt={name}
          className="size-full"
        />
      </div>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("edit")}
          className="bg-background border-border hover:bg-accent focus-visible:ring-ring absolute right-0.5 bottom-0.5 flex size-10 items-center justify-center rounded-full border outline-none focus-visible:ring-2"
        >
          <Pencil aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

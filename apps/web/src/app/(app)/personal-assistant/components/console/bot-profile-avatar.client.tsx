"use client";

import { AuroraOrb } from "@/components/aurora-orb";

interface BotProfileAvatarProps {
  name: string;
  seed: string;
  imageUrl: string | null;
}

/** The bot's one picture at the top of its console, or its orb without one. */
export function BotProfileAvatar({
  name,
  seed,
  imageUrl,
}: BotProfileAvatarProps) {
  return (
    <div className="relative size-38 shrink-0 md:size-46">
      <div className="bg-muted ring-border size-full overflow-hidden rounded-full ring-4">
        {imageUrl ? (
          <img src={imageUrl} alt={name} className="size-full object-cover" />
        ) : (
          <AuroraOrb seed={seed} size={368} alt={name} className="size-full" />
        )}
      </div>
    </div>
  );
}

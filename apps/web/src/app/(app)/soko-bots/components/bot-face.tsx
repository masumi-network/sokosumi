import type { SokoBotAvatarView } from "@sokosumi/core-client";

import { AuroraOrb } from "@/components/aurora-orb";
import { AvatarFace } from "@/components/soko-bot/avatar-face";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import { isCraftedAvatar } from "@/lib/soko-bot/avatar";
import { cn } from "@/lib/utils";

/** A bot's avatar face, or its seeded orb when it predates mascots. */
export function BotFace({
  bot,
  ownerId,
  className,
}: {
  bot: {
    avatarImageUrl: string | null;
    avatarSeed: string | null;
    avatar?: SokoBotAvatarView | null;
  };
  ownerId: string;
  className?: string;
}) {
  if (bot.avatarImageUrl) {
    return (
      <AvatarFace
        src={bot.avatarImageUrl}
        crafted={isCraftedAvatar(bot.avatar)}
        className={className}
      />
    );
  }
  return (
    <AuroraOrb
      seed={bot.avatarSeed ?? defaultOrbSeed(ownerId)}
      size={128}
      alt=""
      className={cn("shrink-0", className)}
    />
  );
}

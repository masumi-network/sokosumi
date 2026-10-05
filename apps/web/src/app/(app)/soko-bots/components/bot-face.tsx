import { AuroraOrb } from "@/components/aurora-orb";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import { cn } from "@/lib/utils";

/** A bot's mascot, or its seeded orb when it predates mascots. */
export function BotFace({
  bot,
  ownerId,
  className,
}: {
  bot: { avatarImageUrl: string | null; avatarSeed: string | null };
  ownerId: string;
  className?: string;
}) {
  if (bot.avatarImageUrl) {
    return (
      <img
        src={bot.avatarImageUrl}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", className)}
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

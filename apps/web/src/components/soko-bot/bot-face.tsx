import { AuroraOrb } from "@/components/aurora-orb";
import { defaultOrbSeed, type OrbExpression } from "@/lib/aurora-orb";
import { cn } from "@/lib/utils";

/**
 * The orb seed `BotFace` draws for a bot: its own seed, or the default orb of
 * `ownerId` (the user it belongs to). A bot with no owner, or one whose owner
 * the caller does not have, falls back to the bot's own id.
 */
export function botFaceSeed(
  bot: { id: string; avatarSeed?: string | null },
  ownerId?: string | null,
): string {
  return bot.avatarSeed ?? defaultOrbSeed(ownerId ?? bot.id);
}

/**
 * A bot's Soko Bot avatar, or its seeded orb when it predates avatars. The
 * caller sets the display size (and any ring) through `className`; `orbSize`
 * is the orb's draw resolution, about twice the display size.
 */
export function BotFace({
  imageUrl,
  seed,
  alt = "",
  orbSize = 128,
  animate = false,
  expression,
  className,
}: {
  imageUrl: string | null;
  seed: string;
  /** Accessible name; empty when the face is decorative. */
  alt?: string;
  orbSize?: number;
  /** Live canvas (one rAF loop); use for a single hero orb only. */
  animate?: boolean;
  /** Eyes override for the orb; omit for its resting look. */
  expression?: OrbExpression;
  className?: string;
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={alt}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <AuroraOrb
      seed={seed}
      size={orbSize}
      animate={animate}
      expression={expression ?? null}
      alt={alt}
      className={cn("shrink-0", className)}
    />
  );
}

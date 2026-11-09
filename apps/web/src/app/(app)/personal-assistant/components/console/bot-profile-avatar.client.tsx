"use client";

import type {
  SokoBotAvatarState,
  SokoBotAvatarView,
} from "@sokosumi/core-client";

import { AuroraOrb } from "@/components/aurora-orb";
import { AvatarLoop } from "@/components/soko-bot/avatar-loop";
import {
  useAvatarStateCopy,
  usePlayOnce,
} from "@/components/soko-bot/avatar-state";
import { avatarSources } from "@/lib/soko-bot/avatar";

interface BotProfileAvatarProps {
  name: string;
  seed: string;
  imageUrl: string | null;
  avatar: SokoBotAvatarView | null;
  state: SokoBotAvatarState;
}

export function BotProfileAvatar({
  name,
  seed,
  imageUrl,
  avatar,
  state,
}: BotProfileAvatarProps) {
  const { alt } = useAvatarStateCopy();
  const [playing, stop] = usePlayOnce(state, true);
  const sources = avatarSources(avatar, state, imageUrl);

  return (
    <div className="relative size-38 shrink-0 md:size-46">
      <div className="bg-muted ring-border size-full overflow-hidden rounded-full ring-4">
        {sources.still ? (
          <AvatarLoop
            poster={sources.still}
            src={sources.loopLarge}
            playing={playing}
            onEnded={stop}
            alt={alt(name, state)}
            className="size-full object-cover"
          />
        ) : (
          <AuroraOrb seed={seed} size={368} alt={name} className="size-full" />
        )}
      </div>
    </div>
  );
}

"use client";

import type {
  SokoBotAvatarState,
  SokoBotAvatarView,
} from "@sokosumi/core-client";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

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
  /** The studio; null when the viewer cannot change this avatar. */
  editHref: string | null;
}

/**
 * The bot's round portrait at the top of its console. It plays the current
 * state once when the page opens and once on every change, then rests on that
 * state's still. A legacy avatar or a state with no loop yet never moves.
 */
export function BotProfileAvatar({
  name,
  seed,
  imageUrl,
  avatar,
  state,
  editHref,
}: BotProfileAvatarProps) {
  const t = useTranslations("App.SokoBot.Avatar");
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
      {editHref ? (
        <Link
          href={editHref}
          aria-label={t("edit")}
          className="bg-background border-border hover:bg-accent focus-visible:ring-ring absolute right-0.5 bottom-0.5 flex size-10 items-center justify-center rounded-full border outline-none focus-visible:ring-2"
        >
          <Pencil aria-hidden className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

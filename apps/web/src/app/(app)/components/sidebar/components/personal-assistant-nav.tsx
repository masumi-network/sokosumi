import { Suspense } from "react";

import { defaultOrbSeed } from "@/lib/aurora-orb";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import PersonalAssistantNavClient, {
  type SidebarSokoBotAvatar,
} from "./personal-assistant-nav.client";

/** The workspace's Soko Bots, your own first, for the sidebar stack. */
async function loadWorkspaceBots(): Promise<SidebarSokoBotAvatar[]> {
  try {
    const team = await sokoBotService.getTeam();
    return team.members
      .flatMap((member) =>
        member.bot
          ? [
              {
                isYou: member.isYou,
                id: member.bot.id,
                imageUrl: member.bot.avatarImageUrl,
                seed: member.bot.avatarSeed ?? defaultOrbSeed(member.userId),
              },
            ]
          : [],
      )
      .sort((a, b) => Number(b.isYou) - Number(a.isYou))
      .map(({ isYou: _isYou, ...bot }) => bot);
  } catch {
    return [];
  }
}

/** No bots yet: a few mascots from the pool, so the entry still shows faces. */
async function loadPreviewAvatars(): Promise<SidebarSokoBotAvatar[]> {
  try {
    const avatars = await sokoBotService.listAvatars(12, []);
    return avatars
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((avatar) => ({
        id: avatar.id,
        imageUrl: avatar.imageUrl,
        seed: "",
      }));
  } catch {
    return [];
  }
}

async function WithBots() {
  const workspaceBots = await loadWorkspaceBots();
  const bots =
    workspaceBots.length > 0 ? workspaceBots : await loadPreviewAvatars();
  return <PersonalAssistantNavClient bots={bots} />;
}

/**
 * Sidebar entry for the Soko Bots page. Streams in the avatar stack so the
 * nav never waits on Core. Hidden entirely while the feature is in beta for
 * whitelisted domains: the route 404s for everyone else, so an entry pointing
 * at it would only be a dead end.
 */
export default function PersonalAssistantNav({
  enabled,
}: {
  enabled: boolean;
}) {
  if (!enabled) return null;
  return (
    <Suspense fallback={<PersonalAssistantNavClient />}>
      <WithBots />
    </Suspense>
  );
}

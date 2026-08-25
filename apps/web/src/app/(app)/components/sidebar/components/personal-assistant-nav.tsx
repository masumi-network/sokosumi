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

async function WithBots() {
  const bots = await loadWorkspaceBots();
  return <PersonalAssistantNavClient bots={bots} />;
}

/**
 * Sidebar entry for the Soko Bots page. Streams in the avatar stack so the
 * nav never waits on Core.
 */
export default function PersonalAssistantNav() {
  return (
    <Suspense fallback={<PersonalAssistantNavClient />}>
      <WithBots />
    </Suspense>
  );
}

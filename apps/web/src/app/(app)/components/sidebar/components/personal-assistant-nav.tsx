import { Suspense } from "react";

import { defaultOrbSeed } from "@/lib/aurora-orb";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import PersonalAssistantNavClient, {
  type SidebarSokoBotAvatar,
} from "./personal-assistant-nav.client";

/**
 * The face the row shows: the workspace's first Soko Bot, yours when you have
 * one. Null in a workspace with none, where the row falls back to the bot
 * icon rather than borrowing a mascot that belongs to nobody.
 */
async function loadWorkspaceBot(): Promise<SidebarSokoBotAvatar | null> {
  try {
    const { members } = await sokoBotService.getTeam();
    const withBot = members.filter((member) => member.bot);
    const member = withBot.find(({ isYou }) => isYou) ?? withBot[0];
    if (!member?.bot) {
      return null;
    }
    return {
      id: member.bot.id,
      imageUrl: member.bot.avatarImageUrl,
      seed: member.bot.avatarSeed ?? defaultOrbSeed(member.userId),
    };
  } catch {
    return null;
  }
}

async function WithBot() {
  return <PersonalAssistantNavClient bot={await loadWorkspaceBot()} />;
}

/**
 * Sidebar entry for the Soko Bots page. Streams in the face so the nav never
 * waits on Core. Hidden without Soko Bot beta access: the route 404s for
 * everyone else, so an entry pointing at it would only be a dead end.
 */
export default function PersonalAssistantNav({
  enabled,
}: {
  enabled: boolean;
}) {
  if (!enabled) return null;
  return (
    <Suspense fallback={<PersonalAssistantNavClient />}>
      <WithBot />
    </Suspense>
  );
}

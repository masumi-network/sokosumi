import { cache, Suspense } from "react";

import { defaultOrbSeed } from "@/lib/aurora-orb";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import PersonalAssistantNavClient, {
  type SidebarSokoBotLive,
} from "./personal-assistant-nav.client";

/**
 * The bot the row shows: the workspace's first Soko Bot, yours when you have
 * one. Null in a workspace with none, where the row falls back to the static
 * entry rather than borrowing a mascot that belongs to nobody. Cached per
 * request, so the sidebar and the phone Chats page share one team load.
 */
const loadWorkspaceBot = cache(async (): Promise<SidebarSokoBotLive | null> => {
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
      name: member.bot.name,
      status: member.bot.status,
      lastActivityAt: member.bot.lastActivityAt,
      isYours: member.isYou,
    };
  } catch {
    return null;
  }
});

async function WithBot() {
  return <PersonalAssistantNavClient bot={await loadWorkspaceBot()} />;
}

/**
 * Sidebar entry for Soko Bots. Streams in the live row so the nav never
 * waits on Core. Hidden without Soko Bot beta access: the route 404s for
 * everyone else, so an entry pointing at it would only be a dead end.
 */
export default function PersonalAssistantNav() {
  return (
    <Suspense fallback={<PersonalAssistantNavClient />}>
      <WithBot />
    </Suspense>
  );
}

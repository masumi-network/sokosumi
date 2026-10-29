import { cache, Suspense } from "react";

import { defaultOrbSeed } from "@/lib/aurora-orb";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import PersonalAssistantNavClient, {
  type SidebarSokoBotLive,
} from "./personal-assistant-nav.client";

/**
 * Your own Soko Bot. Null when you have none, where the row falls back to the
 * static Soko Bots entry rather than showing a teammate's bot as if it were
 * yours. Cached per request, so the sidebar and the phone Chats page share
 * one team load.
 */
const loadYourBot = cache(async (): Promise<SidebarSokoBotLive | null> => {
  try {
    const { members } = await sokoBotService.getTeam();
    const member = members.find(({ isYou }) => isYou);
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
      avatarState: member.bot.avatarState ?? "idle",
      avatar: member.bot.avatar ?? null,
    };
  } catch {
    return null;
  }
});

async function WithBot() {
  return <PersonalAssistantNavClient bot={await loadYourBot()} />;
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

import { Suspense } from "react";

import { SidebarPrototypeOnly } from "@/components/prototype/sidebar-prototype.client";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import PersonalAssistantNavClient from "./personal-assistant-nav.client";
import {
  type SidebarSokoBotLive,
  SokoBotLiveNav,
} from "./personal-assistant-nav.prototype.client";

/**
 * The face the row shows: the workspace's first Soko Bot, yours when you have
 * one. Null in a workspace with none, where the row falls back to the bot
 * icon rather than borrowing a mascot that belongs to nobody.
 */
async function loadWorkspaceBot(): Promise<SidebarSokoBotLive | null> {
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
      // PROTOTYPE: live state for sidebar variants b to d.
      name: member.bot.name,
      status: member.bot.status,
      lastActivityAt: member.bot.lastActivityAt,
      isYours: member.isYou,
    };
  } catch {
    return null;
  }
}

async function WithBot() {
  const bot = await loadWorkspaceBot();
  return (
    <>
      <SidebarPrototypeOnly variants={["a"]}>
        <PersonalAssistantNavClient bot={bot} />
      </SidebarPrototypeOnly>
      <SidebarPrototypeOnly variants={["b", "c", "d"]}>
        <SokoBotLiveNav bot={bot} />
      </SidebarPrototypeOnly>
    </>
  );
}

/**
 * Sidebar entry for the Soko Bots page. Streams in the face so the nav never
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

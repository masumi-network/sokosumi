import "server-only";

import type { SharedSokoBotSummary, SokoBotTeam } from "@sokosumi/core-client";

import {
  type DirectoryBot,
  personalDirectoryBot,
  sharedDirectoryBot,
} from "@/app/agents/soko-bot-directory";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { SOKO_BOT_ROUTE, sokoBotConsoleRoute } from "@/lib/soko-bot/constants";

import type { CreateSokoBotProject } from "./components/create-soko-bot-dialog.client";
import { loadSharedBots } from "./shared-bots";

/** View model: a Soko Bot the viewer configures, and what they may do to it. */
export interface ManagedBot extends DirectoryBot {
  settingsHref: string;
  /** The `botId` its actions take; `null` for the viewer's own bot. */
  targetId: string | null;
  /** Work it starts on its own is paused; `null` when it can't be paused here. */
  paused: boolean | null;
  canArchive: boolean;
  archivedAt: Date | null;
  canRestore: boolean;
}

export interface SokoBotsManagement {
  /** `null` when Core cannot read the team. */
  team: SokoBotTeam | null;
  /** Own bot first, then the shared ones; live and archived. */
  bots: ManagedBot[];
  /** Choices for the create dialog; `null` when Core sends no shared bots. */
  projects: CreateSokoBotProject[] | null;
}

/** Paused state from the bot's stats; `null` when they cannot be read. */
function readPaused(botId?: string): Promise<boolean | null> {
  return sokoBotService
    .getStats(botId)
    .then((stats) => stats.proactive.paused)
    .catch(() => null);
}

/**
 * Shared bots as the manage list shows them. Cuso is CMO's to pause, archive
 * and bring back (ADR 0066), so he gets only his Settings.
 */
export async function loadManagedSharedBots(
  bots: SharedSokoBotSummary[],
  projects: CreateSokoBotProject[],
): Promise<ManagedBot[]> {
  return Promise.all(
    bots.map(async (bot): Promise<ManagedBot> => {
      const live = bot.archivedAt === null;
      const managed = bot.viewerCanManage && !bot.cuso;
      return {
        ...sharedDirectoryBot(bot, projects),
        settingsHref: sokoBotConsoleRoute(bot.id),
        targetId: bot.id,
        paused: live && !bot.cuso ? await readPaused(bot.id) : null,
        canArchive: live && managed,
        archivedAt: bot.archivedAt,
        canRestore: !live && managed,
      };
    }),
  );
}

async function loadOwnBot(team: SokoBotTeam): Promise<ManagedBot | null> {
  const me = team.members.find((member) => member.isYou);
  if (!me?.bot) return null;
  return {
    ...personalDirectoryBot({ ...me, bot: me.bot }),
    settingsHref: SOKO_BOT_ROUTE,
    targetId: null,
    paused: await readPaused(),
    canArchive: true,
    archivedAt: null,
    canRestore: false,
  };
}

/**
 * The bots the viewer configures: their own and every shared bot they reach.
 * Teammates' own bots are theirs to manage, so they are left out.
 */
export async function loadSokoBotsManagement(): Promise<SokoBotsManagement> {
  const [team, shared] = await Promise.all([
    sokoBotService.getTeam().catch((error) => {
      if (error instanceof CoreApiRequestError) return null;
      throw error;
    }),
    loadSharedBots(),
  ]);
  // Shared bots exist only in organization workspaces.
  const sharedHere =
    shared && team?.workspace.kind === "organization" ? shared : null;
  const [own, sharedBots] = await Promise.all([
    team ? loadOwnBot(team) : null,
    sharedHere
      ? loadManagedSharedBots(sharedHere.bots, sharedHere.projects)
      : [],
  ]);

  return {
    team,
    bots: own ? [own, ...sharedBots] : sharedBots,
    projects: sharedHere?.projects ?? null,
  };
}

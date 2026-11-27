import "server-only";

import {
  type SharedSokoBotSummary,
  SokoBotScope,
  type SokoBotStatus,
  type SokoBotTeam,
} from "@sokosumi/core-client";

import { loadSharedBots } from "@/app/soko-bots/shared-bots";
import { botFaceSeed } from "@/components/soko-bot/bot-face";
import { sokoBotService } from "@/lib/services/soko-bot.service";

export type DirectoryBotOwner =
  | { kind: "you"; name: string; image: string | null }
  | { kind: "person"; name: string; image: string | null }
  | { kind: "team" }
  | { kind: "project"; name: string | null };

/** View model: one Soko Bot as the Agents page and its profile show it. */
export interface DirectoryBot {
  id: string;
  name: string | null;
  avatarImageUrl: string | null;
  seed: string;
  status: SokoBotStatus;
  lastActivityAt: Date | null;
  owner: DirectoryBotOwner;
  /** Shared bots talk in one room; personal bots in a direct room. */
  sharedRoomId: string | null;
  /** The viewer may open its console. */
  canConfigure: boolean;
}

export interface BotDirectory {
  workspaceName: string;
  bots: DirectoryBot[];
  hasOwnBot: boolean;
}

function byLiveliness(a: DirectoryBot, b: DirectoryBot): number {
  const rank = (bot: DirectoryBot) =>
    bot.owner.kind === "you" ? 2 : bot.status === "RUNNING" ? 1 : 0;
  const last = (bot: DirectoryBot) => bot.lastActivityAt?.getTime() ?? -1;
  return rank(b) - rank(a) || last(b) - last(a);
}

type TeamMember = SokoBotTeam["members"][number];

/** A member's own bot as the directory shows it. */
export function personalDirectoryBot(
  member: TeamMember & { bot: NonNullable<TeamMember["bot"]> },
): DirectoryBot {
  return {
    id: member.bot.id,
    name: member.bot.name,
    avatarImageUrl: member.bot.avatarImageUrl,
    seed: botFaceSeed(member.bot, member.userId),
    status: member.bot.status,
    lastActivityAt: member.bot.lastActivityAt,
    owner: {
      kind: member.isYou ? "you" : "person",
      name: member.name,
      image: member.image,
    },
    sharedRoomId: null,
    canConfigure: member.isYou,
  };
}

/** A project or workspace bot, named after the project it works for. */
export function sharedDirectoryBot(
  bot: SharedSokoBotSummary,
  projects: { id: string; name: string }[],
): DirectoryBot {
  return {
    id: bot.id,
    name: bot.name,
    avatarImageUrl: bot.avatarImageUrl,
    seed: botFaceSeed(bot),
    status: bot.status,
    lastActivityAt: null,
    owner:
      bot.scope === SokoBotScope.WORKSPACE
        ? { kind: "team" }
        : {
            kind: "project",
            name: projects.find((p) => p.id === bot.projectId)?.name ?? null,
          },
    sharedRoomId: bot.sharedRoomId,
    canConfigure: true,
  };
}

/**
 * Every live Soko Bot of the workspace: each member's own and the shared
 * ones, with who they belong to. Throws when Core cannot read the team.
 */
export async function loadBotDirectory(): Promise<BotDirectory> {
  const [team, shared] = await Promise.all([
    sokoBotService.getTeam(),
    loadSharedBots(),
  ]);

  const personal = team.members.flatMap((member): DirectoryBot[] =>
    member.bot ? [personalDirectoryBot({ ...member, bot: member.bot })] : [],
  );
  const sharedBots = (shared?.bots ?? [])
    .filter((bot) => bot.archivedAt === null)
    .map((bot) => sharedDirectoryBot(bot, shared?.projects ?? []));

  return {
    workspaceName: team.workspace.name,
    bots: [...personal.sort(byLiveliness), ...sharedBots],
    hasOwnBot: personal.some((bot) => bot.owner.kind === "you"),
  };
}

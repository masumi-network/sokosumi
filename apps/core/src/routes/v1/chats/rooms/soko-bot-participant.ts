import type { Prisma } from "@sokosumi/database";
import { getFirstName } from "@sokosumi/utils";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import { sokoBotOwnerOf } from "@/helpers/soko-bot-owner";
import type { ChatRoomSokoBotParticipant } from "@/schemas/chat-room-participant.schema";

export const chatRoomSokoBotSelect = {
  id: true,
  name: true,
  avatarImageUrl: true,
  avatar: {
    select: {
      styleId: true,
      renders: { where: { state: "WORKING" }, select: { loopUrl: true } },
    },
  },
  avatarSeed: true,
  userId: true,
  projectId: true,
  sharedRoomId: true,
  user: { select: { name: true } },
} as const satisfies Prisma.SokoBotSelect;

/** The columns {@link mapChatRoomSokoBotParticipant} reads. */
export interface ChatRoomSokoBotRow {
  id: string;
  name: string | null;
  avatarImageUrl: string | null;
  avatar: { styleId: string; renders: { loopUrl: string | null }[] } | null;
  avatarSeed: string | null;
  userId: string | null;
  projectId: string | null;
  sharedRoomId: string | null;
  user: { name: string } | null;
}

/**
 * A personal bot's orb is seeded from its owner, as it always was. A shared
 * bot has no owner, so its own id seeds it.
 */
export function sokoBotAvatarSeedFor(bot: {
  id: string;
  userId: string | null;
  avatarSeed: string | null;
}): string {
  return bot.avatarSeed ?? `orb:${bot.userId ?? bot.id}`;
}

const SHARED_SOKO_BOT_CAPTION = {
  project: "Project assistant",
  workspace: "Workspace assistant",
} as const;

export function sokoBotCaption(bot: ChatRoomSokoBotRow): string {
  const owner = sokoBotOwnerOf(bot);
  if (owner.kind === "shared") return SHARED_SOKO_BOT_CAPTION[owner.scope];
  const ownerFirst = bot.user ? getFirstName(bot.user.name) : null;
  return ownerFirst
    ? `${ownerFirst}'s personal assistant`
    : "Personal assistant";
}

/** A Soko Bot as a room roster or a message sender shows it. */
export function mapChatRoomSokoBotParticipant(
  bot: ChatRoomSokoBotRow,
): ChatRoomSokoBotParticipant {
  const owner = sokoBotOwnerOf(bot);
  return {
    id: bot.id,
    name: sokoBotDisplayName(bot),
    caption: sokoBotCaption(bot),
    image: bot.avatarImageUrl ?? null,
    avatarSeed: sokoBotAvatarSeedFor(bot),
    avatarStyleId: bot.avatar?.styleId ?? null,
    workingLoopUrl: bot.avatar?.renders[0]?.loopUrl ?? null,
    ownerUserId: owner.kind === "personal" ? owner.userId : null,
    scope: owner.kind === "personal" ? "personal" : owner.scope,
    sharedRoomId: bot.sharedRoomId,
    presence: "online",
  };
}

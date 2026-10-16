import type { Prisma } from "@sokosumi/database";
import type { SokoBotPersona } from "@sokosumi/soko-bot";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import {
  isPersonalSokoBot,
  isSharedSokoBot,
  sharedSokoBotScopeKind,
} from "@/helpers/soko-bot-kind";
import {
  readSokoBotPacketAudience,
  type SokoBotPacketAudience,
  type SokoBotTurnReader,
  sharedSokoBotAudience,
  sokoBotSharedScopeOf,
  sokoBotTurnReader,
} from "@/helpers/task-visibility";
import prisma, { type DbClient } from "@/lib/db/prisma";
import { sokoBotActingUserId } from "@/lib/soko-bot/acting-user";

/**
 * Who owns a Soko Bot. A personal bot has a user; a shared bot belongs to a
 * project or to the whole workspace and has no user at all.
 */
export type SokoBotOwner =
  | { kind: "personal"; userId: string }
  | {
      kind: "shared";
      scope: "project" | "workspace";
      projectId: string | null;
    };

/**
 * The owner columns of a Soko Bot row. `userId` is nullable here ahead of
 * the schema: a shared bot has no owner.
 */
export interface SokoBotOwnerColumns {
  userId: string | null;
  projectId: string | null;
}

/** The owner columns plus the loaded owner relation, for display. */
export interface SokoBotOwnerNameSource {
  userId: string | null;
  user: { name: string | null } | null;
}

export function sokoBotOwnerOf(bot: SokoBotOwnerColumns): SokoBotOwner {
  if (isPersonalSokoBot(bot)) return { kind: "personal", userId: bot.userId };
  return {
    kind: "shared",
    scope: sharedSokoBotScopeKind(bot.projectId),
    projectId: bot.projectId,
  };
}

/** The owner's name to show, or `null` for a shared bot. */
export function sokoBotOwnerName(bot: SokoBotOwnerNameSource): string | null {
  return isPersonalSokoBot(bot) ? (bot.user?.name ?? null) : null;
}

/** The audience a turn answers, read from its context packet. */
export function sokoBotTurnAudience(turn: {
  sokoBot: { userId: string | null };
  contextSnapshot: { packet: unknown } | null;
}): SokoBotPacketAudience | undefined {
  const audience = readSokoBotPacketAudience(turn.contextSnapshot?.packet);
  if (isPersonalSokoBot(turn.sokoBot)) return audience;
  return sharedSokoBotAudience(audience);
}

/** Who reads through a turn: its member, its audience, a shared bot's scope. */
export function sokoBotTurnReaderOf(turn: {
  sokoBotId: string;
  requestedByUserId: string | null;
  sokoBot: {
    userId: string | null;
    workspaceId: string;
    projectId: string | null;
  };
  contextSnapshot: { packet: unknown } | null;
}): SokoBotTurnReader {
  return sokoBotTurnReader(
    sokoBotActingUserId(turn),
    sokoBotTurnAudience(turn),
    sokoBotSharedScopeOf({ id: turn.sokoBotId, ...turn.sokoBot }),
  );
}

/** How another bot's Task event is signed in a packet. */
export function sokoBotAuthorLabel(
  bot: SokoBotOwnerNameSource & { name: string | null },
): string {
  const name = sokoBotDisplayName(bot);
  if (isSharedSokoBot(bot)) return `${name}, a shared team assistant`;
  return `${name}, ${bot.user?.name ?? "another person"}'s assistant`;
}

/** The fields {@link sokoBotOwnerName} and {@link sokoBotAuthorLabel} read. */
export const SOKO_BOT_OWNER_NAME_SELECT = {
  name: true,
  userId: true,
  user: { select: { name: true } },
} as const satisfies Prisma.SokoBotSelect;

/** The persona a bot introduces itself with: no owner for a shared bot. */
export function sokoBotPersonaOf(
  bot: SokoBotOwnerNameSource & { name: string | null },
): SokoBotPersona {
  return {
    name: bot.name,
    ownerName: sokoBotOwnerName(bot),
    ...(isPersonalSokoBot(bot) ? {} : { shared: true }),
  };
}

/** Loads {@link sokoBotPersonaOf} for the system prompt. */
export async function loadSokoBotPersona(
  sokoBotId: string,
  client: DbClient = prisma,
): Promise<SokoBotPersona> {
  const bot = await client.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: SOKO_BOT_OWNER_NAME_SELECT,
  });
  return bot ? sokoBotPersonaOf(bot) : { name: null, ownerName: null };
}

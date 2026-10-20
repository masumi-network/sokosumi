import type { Prisma } from "@sokosumi/database";
import { isPersonalSokoBot } from "@/helpers/soko-bot-kind";
import prisma, { type DbClient } from "@/lib/db/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// `post_chat` keys its message `soko-bot-tool:<turnId>:<toolCallId>`.
const TOOL_MESSAGE_KEY = /^soko-bot-tool:([^:]+):/;

function turnIdOf(metadata: Prisma.JsonValue): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return null;
  const sokoBot = metadata.soko_bot;
  if (!sokoBot || typeof sokoBot !== "object" || Array.isArray(sokoBot))
    return null;
  const turnId = sokoBot.turn_id;
  return typeof turnId === "string" && UUID.test(turnId) ? turnId : null;
}

/**
 * Who a Soko Bot's message speaks for. A personal bot speaks for its owner.
 * A shared bot has no owner: its message speaks for the member whose turn
 * wrote it: the turn id in the metadata of a delivered answer, or in the
 * client key of a `post_chat` message. Null when it carries no turn of that
 * bot.
 */
export async function sokoBotMessageMemberId(
  bot: { id: string; userId: string | null },
  message: { metadata: Prisma.JsonValue; clientMessageId: string | null },
  client: DbClient = prisma,
): Promise<string | null> {
  if (isPersonalSokoBot(bot)) return bot.userId;
  const toolTurnId = message.clientMessageId?.match(TOOL_MESSAGE_KEY)?.[1];
  const turnId =
    turnIdOf(message.metadata) ??
    (toolTurnId && UUID.test(toolTurnId) ? toolTurnId : null);
  if (turnId === null) return null;
  const turn = await client.sokoBotTurn.findFirst({
    where: { id: turnId, sokoBotId: bot.id },
    select: { requestedByUserId: true },
  });
  return turn?.requestedByUserId ?? null;
}

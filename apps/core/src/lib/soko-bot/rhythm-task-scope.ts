import type { Prisma } from "@sokosumi/database";
import { isPersonalSokoBot } from "@/helpers/soko-bot-kind";
import {
  buildSokoBotOwnerTaskVisibilityWhere,
  buildSokoBotTaskWhere,
} from "@/helpers/task-visibility";

/**
 * The bot columns a rhythm needs to know whose work it follows. A shared bot
 * (`userId: null`) must carry `projectId`: read without it, a project bot
 * would see its whole workspace.
 */
export type RhythmScopeBot = { id: string; workspaceId: string } & (
  | { userId: string; projectId?: string | null }
  | { userId: null; projectId: string | null }
);

/**
 * Which Tasks a bot's rhythms, nudges and board digests read.
 *
 * A personal bot reads what its owner can see, and its own Tasks are its
 * owner's plus those assigned to it. A shared bot has no owner: it reads the
 * PUBLIC Tasks of its scope, and its own Tasks are those assigned to it or
 * created by it.
 */
export interface RhythmTaskScope {
  /** Null for a shared bot. */
  ownerUserId: string | null;
  visible: Prisma.TaskWhereInput;
  own: Prisma.TaskWhereInput[];
  /**
   * Every arm must hold for a Task that is not the bot's own. Not
   * `NOT: { OR: own }`: SQL drops the rows whose columns in it are null.
   */
  notOwn: Prisma.TaskWhereInput[];
  /** The Tasks a nudge may chase, spread into a Task where. */
  chased: Prisma.TaskWhereInput;
}

function notThisBot(
  column: "assigneeSokoBotId" | "creatorSokoBotId",
  sokoBotId: string,
): Prisma.TaskWhereInput {
  return { OR: [{ [column]: null }, { [column]: { not: sokoBotId } }] };
}

export function rhythmTaskScope(bot: RhythmScopeBot): RhythmTaskScope {
  if (isPersonalSokoBot(bot)) {
    return {
      ownerUserId: bot.userId,
      visible: buildSokoBotOwnerTaskVisibilityWhere(bot.userId),
      own: [{ ownerId: bot.userId }, { assigneeSokoBotId: bot.id }],
      notOwn: [
        { OR: [{ ownerId: { not: bot.userId } }, { ownerId: null }] },
        notThisBot("assigneeSokoBotId", bot.id),
      ],
      chased: { ownerId: bot.userId },
    };
  }
  const visible = buildSokoBotTaskWhere(bot);
  return {
    ownerUserId: null,
    visible,
    own: [{ assigneeSokoBotId: bot.id }, { creatorSokoBotId: bot.id }],
    notOwn: [
      notThisBot("assigneeSokoBotId", bot.id),
      notThisBot("creatorSokoBotId", bot.id),
    ],
    chased: visible,
  };
}

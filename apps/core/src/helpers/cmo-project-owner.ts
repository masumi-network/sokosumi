import { MemberRole } from "@sokosumi/database";
import { getSokoBotVersion, type SokoBotVersion } from "@sokosumi/soko-bot";
import { isSharedSokoBot } from "@/helpers/soko-bot-kind";
import prisma, { type DbClient } from "@/lib/db/prisma";

export interface CmoProjectOwnerBot {
  userId: string | null;
  projectId?: string | null;
  workspaceId: string;
  createdByUserId?: string | null;
  versionId?: string | null;
}

/**
 * Whether `userId` is an authenticated owner of this shared CMO project bot
 * under a version that opts into `cmoOwnerAudience`.
 *
 * Fail-closed rules:
 * - Never true for another assistant (`askedByBot` or `chainDepth > 0`) or a
 *   missing user id.
 * - Never true for a personal bot, a workspace-wide shared bot (`projectId ==
 *   null`), or a non-CMO version (`profile !== "cmo"`).
 * - Strictly gated behind `version.cmoOwnerAudience === true` so live and
 *   control versions remain byte-identical and issue zero extra queries.
 * - Requires a live organization membership in the bot's own workspace where
 *   the speaker is either an organization `OWNER` or the member who hired this
 *   Cuso (`bot.createdByUserId === userId`). Former members and other workspace
 *   members stay `TEAMMATE`.
 */
export async function isAuthenticatedCmoProjectOwner(
  input: {
    bot: CmoProjectOwnerBot;
    version?: Pick<SokoBotVersion, "profile" | "cmoOwnerAudience"> | null;
    userId: string | null | undefined;
    askedByBot?: boolean;
    chainDepth?: number;
  },
  client: DbClient = prisma,
): Promise<boolean> {
  if (input.askedByBot === true || (input.chainDepth ?? 0) > 0) return false;
  const userId = input.userId?.trim();
  if (!userId) return false;
  if (!isSharedSokoBot(input.bot) || !input.bot.projectId) return false;
  const version =
    input.version ??
    (input.bot.versionId ? getSokoBotVersion(input.bot.versionId) : null);
  if (!version || version.profile !== "cmo" || !version.cmoOwnerAudience) {
    return false;
  }
  const member = await client.member.findFirst({
    where: {
      userId,
      organization: { workspace: { is: { id: input.bot.workspaceId } } },
    },
    select: { role: true },
  });
  if (!member) return false;
  return (
    member.role === MemberRole.OWNER || input.bot.createdByUserId === userId
  );
}

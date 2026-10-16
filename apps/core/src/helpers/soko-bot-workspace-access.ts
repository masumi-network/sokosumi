import type { Prisma } from "@sokosumi/database";

/**
 * The one meaning of "this owner may still act in this workspace".
 *
 * A Soko Bot acts as its owner, so it may only reach a workspace the owner can
 * reach: their own personal workspace, or an organization workspace they are
 * still a member of. Membership is read at call time, because leaving an
 * organization removes the `Member` row and nothing else. Neither the bot, nor
 * its API keys, nor its stored workspace context changes on exit.
 *
 * Both the key authentication path and the in-process runtime evaluate this,
 * so a bot whose owner has left is refused wherever it knocks.
 *
 * A null user is a shared Soko Bot acting on its own, for nobody (ADR 0057).
 * The bot is its own principal there, so only an Organization workspace
 * qualifies.
 */
export function sokoBotWorkspaceAccessWhere(
  userId: string | null,
  workspaceId: string,
): Prisma.WorkspaceWhereInput {
  if (userId === null)
    return { id: workspaceId, organizationId: { not: null } };
  return {
    id: workspaceId,
    OR: [{ userId }, { organization: { members: { some: { userId } } } }],
  };
}

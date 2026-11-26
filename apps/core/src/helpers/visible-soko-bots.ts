import type { Prisma } from "@sokosumi/database";

/**
 * The Soko Bots a member sees in a workspace: their own personal bot, and
 * every Project and workspace bot when the workspace belongs to an
 * Organization, as `memberSokoBot` reaches them. Someone else's personal bot
 * never. The caller has already proved the member reaches the workspace.
 */
export function visibleSokoBotWhere(
  userId: string,
  workspaceId: string,
  options: { projectId?: string; sourceId?: string } = {},
): Prisma.SokoBotWhereInput {
  return {
    workspaceId,
    archivedAt: null,
    deletedAt: null,
    // A Project's calendar shows its own bot; the workspace source, none.
    ...(options.projectId
      ? { projectId: options.projectId }
      : options.sourceId
        ? { projectId: null }
        : {}),
    OR: [
      { userId },
      { userId: null, workspace: { organizationId: { not: null } } },
    ],
  };
}

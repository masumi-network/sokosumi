import type { Prisma } from "@sokosumi/database";

export type LastWorkspaceRemoval =
  | { type: "personal" }
  | { type: "organization"; organizationId: string };

/**
 * True when removing this workspace would leave the user with zero workspaces.
 * Personal delete needs any remaining org membership. Organization delete
 * needs a personal workspace or another org membership.
 *
 * Org membership is enough: organization create upserts the workspace row.
 * Do not require that row here or last-workspace can disagree with create.
 */
export async function isLastWorkspace(
  userId: string,
  removing: LastWorkspaceRemoval,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  if (removing.type === "personal") {
    const membership = await tx.member.findFirst({
      where: { userId },
      select: { id: true },
    });
    return membership == null;
  }

  const personalWorkspace = await tx.workspace.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (personalWorkspace) {
    return false;
  }

  const otherMembership = await tx.member.findFirst({
    where: {
      userId,
      organizationId: { not: removing.organizationId },
    },
    select: { id: true },
  });

  return otherMembership == null;
}

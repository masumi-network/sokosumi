import { z } from "@hono/zod-openapi";
import type { MemberRole } from "@sokosumi/database";
import { forbidden, notFound } from "@/helpers/error";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import prisma from "@/lib/db/prisma";

export const workspaceConsentParamsSchema = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});

export async function requireWorkspaceConsentAccess(input: {
  workspaceId: string;
  userId: string;
  allowedRoles?: MemberRole[];
}) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { userId: true, organizationId: true },
  });

  if (!workspace) {
    throw notFound("Workspace not found");
  }

  if (workspace.organizationId) {
    await resolveMemberOrganizationById({
      id: workspace.organizationId,
      userId: input.userId,
      tx: prisma,
      allowedRoles: input.allowedRoles,
    });
  } else if (workspace.userId !== input.userId) {
    throw forbidden("You do not have access to this workspace");
  }
}

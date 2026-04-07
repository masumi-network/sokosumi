import type { Prisma } from "@sokosumi/database";
import {
  buildWorkspaceReadWhere,
  resolveWorkspaceForContext,
} from "@sokosumi/database/helpers";
import { memberRepository } from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";
import type { UserAuthenticationContext } from "@/middleware/auth";

import { badRequest } from "./error";

export interface UserReadScope {
  workspaceId: string;
  ownerUserId: string | null;
  organizationId: string | null;
}

export async function assertValidMemberIdFilter(
  authContext: UserAuthenticationContext,
  memberId: string | undefined,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (!memberId) {
    return;
  }

  if (!authContext.organizationId) {
    throw badRequest("memberId is only supported in organization workspaces.");
  }

  const member = await memberRepository.getMemberByUserIdAndOrganizationId(
    memberId,
    authContext.organizationId,
    tx,
  );

  if (!member) {
    throw badRequest(
      "memberId must belong to the active organization workspace.",
    );
  }
}

export async function resolveUserReadScope(
  authContext: UserAuthenticationContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<UserReadScope> {
  const workspace = await resolveWorkspaceForContext(
    authContext.userId,
    authContext.organizationId,
    tx,
  );

  return {
    workspaceId: workspace.id,
    ownerUserId: authContext.organizationId ? null : authContext.userId,
    organizationId: authContext.organizationId,
  };
}

export function buildScopedReadWhere(
  scope: UserReadScope,
  memberId?: string,
): {
  workspaceId: string;
  userId?: string;
} {
  return buildWorkspaceReadWhere(scope, memberId);
}

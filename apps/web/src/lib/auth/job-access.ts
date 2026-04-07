import "server-only";

import type { JobWithSokosumiStatus, Prisma } from "@sokosumi/database";
import {
  canReadWorkspaceScopedRecord,
  resolveWorkspaceForContext,
  type WorkspaceReadScope,
} from "@sokosumi/database/helpers";

import type { Session } from "@/lib/auth/auth";
import prisma from "@/lib/db/prisma";

type SessionRecord = Session["session"] & {
  activeOrganizationId?: string | null;
};

interface WorkspaceScopedJob {
  userId: string;
  workspaceId: string;
}

export interface JobWorkspaceContext {
  userId: string;
  activeOrganizationId: string | null;
}

export function getActiveOrganizationId(session: Session): string | null {
  return (session.session as SessionRecord).activeOrganizationId ?? null;
}

export function getJobWorkspaceContext(session: Session): JobWorkspaceContext {
  return {
    userId: session.user.id,
    activeOrganizationId: getActiveOrganizationId(session),
  };
}

export async function resolveJobWorkspaceReadScope(
  context: JobWorkspaceContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<WorkspaceReadScope> {
  const workspace = await resolveWorkspaceForContext(
    context.userId,
    context.activeOrganizationId,
    tx,
  );

  return {
    workspaceId: workspace.id,
    ownerUserId: context.activeOrganizationId ? null : context.userId,
  };
}

export async function canReadJobInActiveWorkspace(
  job: WorkspaceScopedJob,
  context: JobWorkspaceContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const scope = await resolveJobWorkspaceReadScope(context, tx);
  return canReadWorkspaceScopedRecord(job, scope);
}

export async function canMutateOwnedJobInActiveWorkspace(
  job: WorkspaceScopedJob,
  context: JobWorkspaceContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const scope = await resolveJobWorkspaceReadScope(context, tx);
  return canReadWorkspaceScopedRecord(job, scope, context.userId);
}

export function isJobOwner(
  job: Pick<JobWithSokosumiStatus, "userId">,
  userId: string,
) {
  return job.userId === userId;
}

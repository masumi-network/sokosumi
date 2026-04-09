import {
  type Job,
  type Prisma,
  type Task,
  TaskStatus,
  type User,
} from "@sokosumi/database";
import { findWorkspaceForContext } from "@sokosumi/database/helpers";
import { memberRepository } from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";
import {
  type CoworkerAuthenticationContext,
  type UserAuthenticationContext,
  type WorkspaceContext,
} from "@/middleware/auth";

import type { CoworkerCapability } from "./coworker-capability";
import { badRequest, forbidden, notFound } from "./error";

type WorkspaceContextInput = WorkspaceContext | UserAuthenticationContext;

/**
 * Runtime discriminator for {@link WorkspaceContext} vs user/coworker auth objects
 * (only workspace context carries `workspaceId`).
 */
export function isWorkspaceContext(
  context:
    | WorkspaceContext
    | UserAuthenticationContext
    | CoworkerAuthenticationContext,
): context is WorkspaceContext {
  return "workspaceId" in context;
}

async function ensureWorkspaceContext(
  context: WorkspaceContextInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<WorkspaceContext | null> {
  if (isWorkspaceContext(context)) {
    return context;
  }

  return await resolveWorkspaceContext(context, tx);
}

export async function resolveWorkspaceContext(
  authContext: UserAuthenticationContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<WorkspaceContext | null> {
  const workspace = await findWorkspaceForContext(
    authContext.userId,
    authContext.organizationId,
    tx,
  );

  if (!workspace) {
    return null;
  }

  return {
    workspaceId: workspace.id,
    userId: authContext.userId,
    organizationId: authContext.organizationId,
  };
}

export function buildWorkspaceWhere(
  workspaceContext: WorkspaceContext,
  memberUserId?: string,
): {
  workspaceId: string;
  userId?: string;
} {
  if (workspaceContext.organizationId) {
    return {
      workspaceId: workspaceContext.workspaceId,
      ...(memberUserId ? { userId: memberUserId } : {}),
    };
  }

  return {
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.userId,
  };
}

export async function assertValidMemberIdFilter(
  context: Pick<WorkspaceContext, "organizationId">,
  memberId: string | undefined,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (!memberId) {
    return;
  }

  if (!context.organizationId) {
    throw badRequest("memberId is only supported in organization workspaces.");
  }

  const member = await memberRepository.getMemberByUserIdAndOrganizationId(
    memberId,
    context.organizationId,
    tx,
  );

  if (!member) {
    throw badRequest(
      "memberId must belong to the active organization workspace.",
    );
  }
}

/**
 * Validates job access and returns the job if valid.
 * Checks the caller's readable workspace scope.
 */
export async function requireWorkspaceJobAccess(
  context: WorkspaceContextInput,
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  const workspaceContext = await ensureWorkspaceContext(context, tx);
  const job = workspaceContext
    ? await tx.job.findFirst({
        where: {
          id: jobId,
          ...buildWorkspaceWhere(workspaceContext),
        },
      })
    : null;

  if (!job) {
    throw forbidden("This job is not available in your active workspace.");
  }
  return job;
}

export async function requireOwnedJobAccess(
  context: WorkspaceContextInput,
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job> {
  const workspaceContext = await ensureWorkspaceContext(context, tx);
  const job = workspaceContext
    ? await tx.job.findFirst({
        where: {
          id: jobId,
          userId: workspaceContext.userId,
          workspaceId: workspaceContext.workspaceId,
        },
      })
    : null;

  if (!job) {
    throw forbidden("You can only access your own jobs");
  }

  return job;
}

/**
 * Validates user access and fetches the user record
 * Throws 403 if trying to access another user, 404 if user doesn't exist
 *
 * @param authenticatedUserId - The authenticated user's ID
 * @param requestedUserId - The requested user ID from the path parameter
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The user record
 * @throws {forbidden} If user IDs don't match
 * @throws {notFound} If user doesn't exist
 *
 * @example
 * // In a route handler
 * const userRecord = await requireUserAccess(user.id, id);
 *
 * @example
 * // With transaction
 * await prisma.$transaction(async (tx) => {
 *   const userRecord = await requireUserAccess(user.id, id, tx);
 *   // ... other operations within transaction
 * });
 */
export async function requireUserAccess(
  authenticatedUserId: string,
  requestedUserId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<User> {
  if (authenticatedUserId !== requestedUserId) {
    throw forbidden("You can only access your own user data");
  }

  const user = await tx.user.findUnique({
    where: { id: requestedUserId },
  });

  if (!user) {
    throw notFound("User not found");
  }

  return user;
}

/**
 * Validates workspace-scoped read access to a task (organization collaborators
 * or personal workspace owner) and fetches the task record.
 *
 * Pass a {@link WorkspaceContext} from middleware when available to avoid
 * resolving the workspace again inside the transaction.
 */
export async function requireWorkspaceTaskAccess(
  context: WorkspaceContextInput,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const workspaceContext = await ensureWorkspaceContext(context, tx);
  const task = workspaceContext
    ? await tx.task.findFirst({
        where: {
          id: taskId,
          archivedAt: null,
          ...buildWorkspaceWhere(workspaceContext),
        },
      })
    : null;

  if (!task) {
    throw notFound("Task not found");
  }

  return task;
}

/**
 * Validates that the task is owned by the caller in the active workspace and
 * fetches the task record.
 *
 * Pass a {@link WorkspaceContext} from middleware when available to avoid
 * resolving the workspace again inside the transaction.
 */
export async function requireOwnedTaskAccess(
  context: WorkspaceContextInput,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  const workspaceContext = await ensureWorkspaceContext(context, tx);
  const task = workspaceContext
    ? await tx.task.findFirst({
        where: {
          id: taskId,
          archivedAt: null,
          userId: workspaceContext.userId,
          workspaceId: workspaceContext.workspaceId,
        },
      })
    : null;

  if (!task) {
    throw notFound("Task not found");
  }

  return task;
}

/**
 * Validates access to a task based on coworker ownership and fetches the task record.
 * Throws 403 if the authenticated coworker does not have access to the task.
 *
 * @param authContext - The authenticated coworker context
 * @param taskId - The task ID to fetch and validate
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The validated task if access is permitted
 * @throws {notFound} If the task does not exist
 * @throws {forbidden} If coworker does not have access to the task
 *
 * @example
 * const task = await requireCoworkerTaskAccess(authContext, taskId);
 *
 * @example
 * await prisma.$transaction(async (tx) => {
 *   const task = await requireCoworkerTaskAccess(authContext, taskId, tx);
 *   // ... additional operations
 * });
 */
export async function requireCoworkerTaskAccess(
  authContext: CoworkerAuthenticationContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Task> {
  await requireCoworkerCapability(authContext.coworkerId, "tasks", tx);

  const task = await tx.task.findUnique({
    where: {
      id: taskId,
      status: { not: TaskStatus.DRAFT },
      archivedAt: null,
    },
  });
  if (!task) {
    throw notFound("Task not found");
  }
  if (task.coworkerId !== authContext.coworkerId) {
    throw forbidden("You can only access tasks assigned to your coworker");
  }
  return task;
}

async function findUsableCoworkerByCapability(
  coworkerId: string,
  capability: CoworkerCapability,
  tx: Prisma.TransactionClient = prisma,
  options?: {
    requireBaseUrl?: boolean;
  },
) {
  return await tx.coworker.findFirst({
    where: {
      id: coworkerId,
      archivedAt: null,
      isWhitelisted: true,
      capabilities: {
        has: capability,
      },
      ...(options?.requireBaseUrl ? { baseURL: { not: null } } : {}),
    },
    select: {
      id: true,
      slug: true,
      baseURL: true,
    },
  });
}

export async function requireCoworkerCapability(
  coworkerId: string,
  capability: CoworkerCapability,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const coworker = await findUsableCoworkerByCapability(
    coworkerId,
    capability,
    tx,
  );

  if (!coworker) {
    throw forbidden(`Coworker is not allowed to use ${capability}`);
  }
}

export async function requireCoworkerChatCapability(
  coworkerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<{ id: string; slug: string; baseURL: string | null }> {
  const coworker = await findUsableCoworkerByCapability(
    coworkerId,
    "chat",
    tx,
    {
      requireBaseUrl: true,
    },
  );

  if (!coworker) {
    throw forbidden("Coworker chat is not available");
  }

  return coworker;
}

export async function requireTaskAssignableCoworker(
  coworkerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const coworker = await findUsableCoworkerByCapability(
    coworkerId,
    "tasks",
    tx,
  );

  if (!coworker) {
    throw notFound("Coworker not found");
  }
}

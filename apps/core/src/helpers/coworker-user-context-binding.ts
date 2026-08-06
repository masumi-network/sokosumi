import { type Prisma, TaskStatus } from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
  requireUserContext,
  type UserContext,
} from "@/middleware/auth";

import { forbidden } from "./error";
import { hasGrantedWorkspaceAccess } from "./vendor-grants";
import { buildCoworkerSiblingTaskListFilter } from "./vendor-siblings";

/**
 * Ensures a coworker may act as the given workspace user for user-scoped
 * operations (profile, credits, notifications, history, projects, orgs, …).
 *
 * Allowed when either:
 * - the vendor has a **GRANTED** workspace grant for the context workspace, or
 * - the coworker has **baseline** access (assignee / same-vendor sibling) on a
 *   non-DRAFT task owned by that user in the workspace.
 *
 * Unbound `X-Context-User-Id` (no relationship) is rejected. Task delegated
 * create still uses {@link requireUserContext} so first-contact GRANT_PENDING
 * create is unaffected.
 */
export async function assertCoworkerUserContextBinding(
  authContext: CoworkerAuthenticationContext,
  userContext: Pick<UserContext, "userId" | "organizationId">,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const workspace = await workspaceRepository.upsertWorkspaceForContext(
    userContext.userId,
    userContext.organizationId,
    tx,
  );

  const granted = await hasGrantedWorkspaceAccess(
    {
      vendorId: authContext.vendorId,
      workspaceId: workspace.id,
    },
    tx,
  );
  if (granted) {
    return;
  }

  const baselineTask = await tx.task.findFirst({
    where: {
      ownerId: userContext.userId,
      workspaceId: workspace.id,
      archivedAt: null,
      status: { not: TaskStatus.DRAFT },
      ...buildCoworkerSiblingTaskListFilter({
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
      }),
    },
    select: { id: true },
  });

  if (baselineTask) {
    return;
  }

  throw forbidden(
    "Coworker cannot act as this user without a granted workspace access or assigned task relationship",
  );
}

/**
 * Effective user for user-scoped (non-task) operations.
 * Session users and orchestrator-with-context pass through.
 * Coworkers must pass {@link assertCoworkerUserContextBinding}.
 *
 * Prefer this over {@link requireUserContext} outside task/job grant-gated
 * flows so `X-Context-User-Id` cannot impersonate arbitrary users.
 *
 * Uses `authContext.actor === "coworker"` (not `isCoworkerAuthContext`) so
 * unit tests that partial-mock `@/middleware/auth` keep working.
 */
export async function requireAuthorizedUserContext(
  authContext: AuthenticationContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<UserContext> {
  const userContext = requireUserContext(authContext);

  if (authContext.actor === "coworker") {
    await assertCoworkerUserContextBinding(authContext, userContext, tx);
  }

  return userContext;
}

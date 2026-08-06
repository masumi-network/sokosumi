import { type Prisma, TaskStatus, VendorGrantStatus } from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
  requireUserContext,
  type UserContext,
} from "@/middleware/auth";

import { forbidden } from "./error";
import {
  getWorkspaceGrant,
  isGrantDeniedOrRevoked,
  throwGrantAccessError,
} from "./vendor-grants";
import { buildCoworkerSiblingTaskListFilter } from "./vendor-siblings";

/**
 * Ensures a coworker may act as the given workspace user for user-scoped
 * operations (profile, credits, projects, orgs, …).
 *
 * Decision order:
 * 1. **DENIED / REVOKED** grant → reject (terminal; assignment does not override).
 * 2. **GRANTED** grant → allow.
 * 3. Else baseline access (assignee / same-vendor sibling on a non-DRAFT task
 *    owned by that user in the workspace) → allow when no terminal denial.
 * 4. Else reject.
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

  const grant = await getWorkspaceGrant(
    {
      vendorId: authContext.vendorId,
      workspaceId: workspace.id,
    },
    tx,
  );

  if (grant && isGrantDeniedOrRevoked(grant.status)) {
    // Human terminal decision — baseline assignment must not reopen access.
    throwGrantAccessError(grant.status);
  }

  if (grant?.status === VendorGrantStatus.GRANTED) {
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

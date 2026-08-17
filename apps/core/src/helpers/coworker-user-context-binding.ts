import { type Prisma, TaskStatus, VendorGrantStatus } from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";
import { rethrowPersonalWorkspaceMissing } from "@/helpers/personal-workspace-error";

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
 * **Policy (decision order):**
 * 1. **DENIED / REVOKED** grant → reject (terminal; assignment does not override).
 * 2. **GRANTED** grant → allow.
 * 3. Else baseline access (assignee / same-vendor sibling on a non-DRAFT task
 *    owned by that user in the workspace) → allow when no terminal denial.
 * 4. Else reject.
 *
 * Handlers should call {@link requireAuthorizedUserContext} rather than this
 * function directly. Do not re-implement grant/baseline checks in routes.
 *
 * Unbound `X-Context-User-Id` is rejected. Task delegated create still uses
 * {@link requireUserContext} so first-contact GRANT_PENDING create is unaffected.
 * See the handler actor menu on `UserContext` in `@/middleware/auth`.
 */
export async function assertCoworkerUserContextBinding(
  authContext: CoworkerAuthenticationContext,
  userContext: Pick<UserContext, "userId" | "organizationId">,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  let workspace;
  try {
    workspace = await workspaceRepository.resolveWorkspaceForContext(
      userContext.userId,
      userContext.organizationId,
      tx,
    );
  } catch (error) {
    rethrowPersonalWorkspaceMissing(error);
  }

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
 *
 * - Session users and orchestrator-with-context: pass through.
 * - Coworkers: {@link assertCoworkerUserContextBinding} (DENIED/REVOKED →
 *   GRANTED → baseline → reject).
 *
 * **Default for new user-scoped routes** unless the path is task/job
 * grant-gated (`requireUserContext`) or human-only
 * (`requireOwnerUserContext`). Do not branch on `authContext.actor` in the
 * handler.
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

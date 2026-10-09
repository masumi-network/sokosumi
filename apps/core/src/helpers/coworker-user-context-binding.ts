import { type Prisma, TaskStatus, VendorGrantStatus } from "@sokosumi/database";
import { resolveCoworkerContextWorkspace } from "@/helpers/personal-workspace-error";

import { listUserWorkspaces } from "@/helpers/user-workspaces";
import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
  requireUserContext,
  type UserContext,
} from "@/middleware/auth";

import type { UserWorkspaces } from "@/schemas/user-workspace.schema";

import { forbidden } from "./error";
import {
  getWorkspaceGrant,
  isGrantDeniedOrRevoked,
  throwGrantAccessError,
} from "./vendor-grants";
import { buildCoworkerSiblingTaskListFilter } from "./vendor-siblings";

/**
 * Baseline access: a non-DRAFT task the user owns in the workspace, assigned
 * to this coworker or a same-vendor sibling.
 */
function baselineTaskWhere(
  authContext: CoworkerAuthenticationContext,
  userId: string,
  workspaceId: string | { in: string[] },
): Prisma.TaskWhereInput {
  return {
    ownerId: userId,
    workspaceId,
    archivedAt: null,
    status: { not: TaskStatus.DRAFT },
    ...buildCoworkerSiblingTaskListFilter({
      coworkerId: authContext.coworkerId,
      vendorId: authContext.vendorId,
    }),
  };
}

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
  const workspace = await resolveCoworkerContextWorkspace(
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
    where: baselineTaskWhere(authContext, userContext.userId, workspace.id),
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
 * - Session users: pass through.
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

/**
 * Of the user's `workspaceIds`, those a coworker's vendor may act in, by the
 * policy of {@link assertCoworkerUserContextBinding}: DENIED/REVOKED never,
 * GRANTED always, else a baseline task. Binding to one workspace must not
 * reveal the user's others. Session users and Soko Bots keep every id.
 */
export async function filterAuthorizedWorkspaceIds(
  authContext: AuthenticationContext,
  userId: string,
  workspaceIds: string[],
  tx: Prisma.TransactionClient = prisma,
): Promise<Set<string>> {
  if (authContext.actor !== "coworker" || workspaceIds.length === 0) {
    return new Set(workspaceIds);
  }

  const [grants, baselineTasks] = await Promise.all([
    tx.vendorGrant.findMany({
      where: {
        vendorId: authContext.vendorId,
        workspaceId: { in: workspaceIds },
      },
      select: { workspaceId: true, status: true },
    }),
    tx.task.findMany({
      where: baselineTaskWhere(authContext, userId, { in: workspaceIds }),
      select: { workspaceId: true },
      distinct: ["workspaceId"],
    }),
  ]);

  const grantStatusByWorkspace = new Map(
    grants.map((grant) => [grant.workspaceId, grant.status]),
  );
  const baselineWorkspaceIds = new Set(
    baselineTasks.map((task) => task.workspaceId),
  );

  return new Set(
    workspaceIds.filter((workspaceId) => {
      const status = grantStatusByWorkspace.get(workspaceId);
      return (
        status === VendorGrantStatus.GRANTED ||
        ((status === undefined || !isGrantDeniedOrRevoked(status)) &&
          baselineWorkspaceIds.has(workspaceId))
      );
    }),
  );
}

/**
 * The user's organizations whose workspace a coworker's vendor may act in
 * ({@link filterAuthorizedWorkspaceIds}). Session users and Soko Bots keep
 * every id.
 */
export async function filterAuthorizedOrganizationIds(
  authContext: AuthenticationContext,
  userId: string,
  organizationIds: string[],
  tx: Prisma.TransactionClient = prisma,
): Promise<Set<string>> {
  if (authContext.actor !== "coworker" || organizationIds.length === 0) {
    return new Set(organizationIds);
  }

  const workspaces = await tx.workspace.findMany({
    where: { organizationId: { in: organizationIds } },
    select: { id: true, organizationId: true },
  });
  const authorizedWorkspaceIds = await filterAuthorizedWorkspaceIds(
    authContext,
    userId,
    workspaces.map((workspace) => workspace.id),
    tx,
  );

  return new Set(
    workspaces
      .filter((workspace) => authorizedWorkspaceIds.has(workspace.id))
      .flatMap((workspace) =>
        workspace.organizationId ? [workspace.organizationId] : [],
      ),
  );
}

/**
 * The user's workspaces as this caller may see them. A coworker sees only the
 * workspaces its vendor may act in ({@link filterAuthorizedWorkspaceIds}),
 * none marked preferred when the preferred one is hidden, and no invitation
 * count; with none to see it is rejected, so user ids cannot be probed.
 * Session users and Soko Bots see the full list.
 */
export async function listAuthorizedUserWorkspaces(
  authContext: AuthenticationContext,
  userId: string,
): Promise<UserWorkspaces> {
  const listed = await listUserWorkspaces(userId);
  if (authContext.actor !== "coworker") {
    return listed;
  }

  const authorized = await filterAuthorizedWorkspaceIds(
    authContext,
    userId,
    listed.workspaces.map((workspace) => workspace.id),
  );
  const workspaces = listed.workspaces.filter((workspace) =>
    authorized.has(workspace.id),
  );
  if (workspaces.length === 0) {
    throw forbidden(
      "Coworker cannot act as this user without a granted workspace access or assigned task relationship",
    );
  }
  return { workspaces, pendingInvitationCount: 0 };
}

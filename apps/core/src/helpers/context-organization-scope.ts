import type { Prisma } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import type { UserContext } from "@/middleware/auth";
import {
  requireWorkspaceContext,
  type WorkspaceContext,
} from "@/middleware/workspace";

import { forbidden, notFound } from "./error";

/**
 * Organization binding for organization-scoped reads.
 *
 * A coworker or Soko Bot key is authorized for one workspace, but the routes
 * that resolve an organization check membership of the **user**. Without this
 * binding, an actor authorized for Workspace A can read Workspace B data for a
 * user who belongs to both. See SOK-1020.
 *
 * Session users keep every membership they have. They are the human owner of
 * that data, and the organization switcher reads the full list.
 *
 * This binds *which organization a request may target*. It does not change who
 * holds a vendor grant, or when. Grant policy stays in
 * `@/helpers/coworker-user-context-binding`.
 *
 * Every route that takes an organization or workspace identifier from the
 * request and admits agent keys must bind it here.
 * `routes/v1/context-binding.test.ts` scans the organizations, workspaces, and
 * users organization trees and fails when a route forgets.
 */

/** Member filter that matches no organization. */
const MATCHES_NO_ORGANIZATION: Pick<Prisma.MemberWhereInput, "organizationId"> =
  { organizationId: { in: [] } };

/**
 * Rejects a target organization that the caller's context is not bound to.
 *
 * A context actor (coworker, Soko Bot) on a personal workspace
 * (`organizationId: null`) has no organization in scope, so every organization
 * id is rejected.
 */
export function assertOrganizationInContextScope(
  userContext: UserContext,
  organizationId: string,
): void {
  if (userContext.source !== "context") {
    return;
  }

  if (userContext.organizationId !== organizationId) {
    throw forbidden(
      "Agent authentication is not authorized for this organization",
    );
  }
}

/**
 * Member filter fragment limiting a listing to the caller's context.
 *
 * Session users get an empty fragment, so the listing is unchanged. A context
 * actor gets its own organization, or a filter that matches nothing when the
 * context is a personal workspace.
 */
export function contextOrganizationMemberFilter(
  userContext: UserContext,
): Pick<Prisma.MemberWhereInput, "organizationId"> {
  if (userContext.source !== "context") {
    return {};
  }

  const { organizationId } = userContext;

  return organizationId === null ? MATCHES_NO_ORGANIZATION : { organizationId };
}

/**
 * Rejects a target workspace that the caller's context is not bound to.
 *
 * Session users are unaffected; the route's own membership check still applies
 * to them.
 */
export function assertWorkspaceInContextScope(
  userContext: UserContext,
  workspaceContext: WorkspaceContext | null,
  workspaceId: string,
): void {
  if (userContext.source !== "context") {
    return;
  }

  const activeWorkspace = requireWorkspaceContext(workspaceContext);

  if (activeWorkspace.workspaceId !== workspaceId) {
    throw forbidden(
      "Agent authentication is not authorized for this workspace",
    );
  }
}

/**
 * Binds a slug lookup to the caller's context before the organization is
 * resolved.
 *
 * Checking after the lookup would leak which organizations the context user
 * belongs to: "not a member" and "member, but outside your context" would be
 * distinguishable, and a caller could walk slugs to enumerate them. A context
 * actor may therefore only resolve the slug of its own organization, and every
 * other slug answers with the same "not found" a missing organization gets.
 */
export async function assertOrganizationSlugInContextScope(
  userContext: UserContext,
  slug: string,
  tx: Pick<Prisma.TransactionClient, "organization">,
): Promise<void> {
  if (userContext.source !== "context") {
    return;
  }

  const contextOrganization = userContext.organizationId
    ? await tx.organization.findUnique({
        where: { id: userContext.organizationId },
        select: { slug: true },
      })
    : null;

  if (contextOrganization?.slug !== slug) {
    throw notFound("Organization not found", {
      kind: CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND,
    });
  }
}

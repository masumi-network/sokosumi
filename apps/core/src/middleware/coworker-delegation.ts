import { VendorGrantStatus } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

/**
 * Whether a coworker may act inside a given user's workspace context.
 *
 * A coworker API key is issued to a third-party vendor, and `X-Context-User-Id`
 * is chosen by the caller. Existence of the user is NOT authorization: without
 * this check any vendor key could name any user id and every route resolving
 * the effective user through `requireUserContext` would treat it as that user
 * (notifications, history, projects, organization billing/members, …).
 *
 * A relationship exists when at least one of these holds:
 *
 * - the coworker is assigned to the user (`CoworkerAssignment`);
 * - the vendor holds a **GRANTED** workspace grant on the user's personal
 *   workspace or on a workspace of an organization the user belongs to;
 * - the coworker is the assignee of at least one of the user's tasks, i.e.
 *   the user has already engaged it.
 *
 * PENDING deliberately does NOT count. A vendor that reaches any task route
 * with an existing relationship causes `requireGrantedWorkspaceAccessOrRequest`
 * to create a PENDING grant on that *workspace*; counting it here would let one
 * member's engagement hand the vendor context for every other member of the
 * same organization before a human approved anything. Requiring GRANTED does
 * not deadlock delegated create either: `tasks/post.ts` requests its grant from
 * inside the handler, so context is already established by the time the PENDING
 * row appears — it never bootstraps context.
 *
 * Deliberately relationship-level, not capability-level: per-resource
 * authorization (task assignee, vendor-grant status, coworker capability)
 * still runs in the route handlers. This only stops a vendor key from
 * addressing users it has no connection to at all.
 *
 * KNOWN FOLLOW-UP: this currently blocks the documented GRANT_PENDING cold
 * start, where a vendor creates the first delegated task for a new user and a
 * human approves afterwards. `POST /v1/tasks` calls `requireUserContext`
 * before it requests the grant, so the middleware rejects the request before
 * the vendor can ask for permission. Restoring it needs two-tier context —
 * an unapproved context that reaches only delegated task create. See
 * docs/coworker/vendor-workspace-grants-api.md.
 */
export async function hasCoworkerUserDelegation(params: {
  coworkerId: string;
  vendorId: string;
  userId: string;
}): Promise<boolean> {
  const { coworkerId, vendorId, userId } = params;

  const [assignment, grant, assignedTask] = await Promise.all([
    prisma.coworkerAssignment.findUnique({
      where: { coworkerId_userId: { coworkerId, userId } },
      select: { id: true },
    }),
    prisma.vendorGrant.findFirst({
      where: {
        vendorId,
        status: VendorGrantStatus.GRANTED,
        workspace: {
          OR: [{ userId }, { organization: { members: { some: { userId } } } }],
        },
      },
      select: { id: true },
    }),
    prisma.task.findFirst({
      where: { assigneeId: coworkerId, ownerId: userId },
      select: { id: true },
    }),
  ]);

  return assignment !== null || grant !== null || assignedTask !== null;
}

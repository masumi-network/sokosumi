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
 * - the vendor holds a non-rejected workspace grant on the user's personal
 *   workspace or on a workspace of an organization the user belongs to
 *   (PENDING counts: the delegated-create flow requests the grant lazily and
 *   parks the task, so requiring GRANTED here would deadlock that flow);
 * - the coworker is the assignee of at least one of the user's tasks, i.e.
 *   the user has already engaged it.
 *
 * Deliberately relationship-level, not capability-level: per-resource
 * authorization (task assignee, vendor-grant status, coworker capability)
 * still runs in the route handlers. This only stops a vendor key from
 * addressing users it has no connection to at all.
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
        status: {
          notIn: [VendorGrantStatus.DENIED, VendorGrantStatus.REVOKED],
        },
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

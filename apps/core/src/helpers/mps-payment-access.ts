import type { Prisma } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  requireUserAuthContext,
  requireUserContext,
} from "@/middleware/auth";

import { requireTaskOwnership } from "./access-control";
import { notFound, unprocessableEntity } from "./error";
import { requireAssignedOrganizationSeat } from "./organization-assigned-seat";
import { requireVendorAdminMembership } from "./vendor-membership";

export async function requireMpsSellerAdmin(
  auth: AuthenticationContext,
  coworkerId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const user = requireUserAuthContext(auth);
  const coworker = await tx.coworker.findFirst({
    where: { id: coworkerId, archivedAt: null },
    select: { id: true, vendorId: true },
  });
  if (!coworker) {
    throw notFound("Coworker not found");
  }

  await requireVendorAdminMembership(user.userId, coworker.vendorId, tx);
  return coworker;
}

export async function requireTaskPaymentOwner(
  auth: AuthenticationContext,
  taskId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const user = requireUserAuthContext(auth);
  const task = await requireTaskOwnership(requireUserContext(user), taskId, tx);
  if (!task.assigneeId) {
    throw unprocessableEntity("Task must be assigned to a coworker");
  }

  await requireAssignedOrganizationSeat(user.userId, task.organizationId, tx);
  return {
    id: task.id,
    ownerId: user.userId,
    organizationId: task.organizationId,
    assigneeId: task.assigneeId,
    name: task.name,
    description: task.description,
    status: task.status,
    archivedAt: task.archivedAt,
  };
}

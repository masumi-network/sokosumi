import { forbidden, notFound } from "@/helpers/error";
import prisma, { type DbClient } from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  requireInteractiveAdminAuthContext,
  type UserAuthenticationContext,
} from "@/middleware/auth";

export interface PreprodAccessTarget {
  type: "user" | "organization";
  id: string;
}

const RECENT_CHANGES = 20;

/**
 * Who may switch Preprod access: an admin at the keyboard, as themselves. An
 * impersonated session holds the target's role, which Core keeps from being
 * admin when the impersonation starts; this refuses it by name as well.
 */
export function requirePreprodAccessOperator(
  authContext: AuthenticationContext,
): UserAuthenticationContext {
  const admin = requireInteractiveAdminAuthContext(authContext);
  if (admin.impersonatedBy) {
    throw forbidden("Preprod access cannot be changed while impersonating");
  }
  return admin;
}

/** The flag with its recent changes, newest first. */
export async function preprodAccessOf(
  db: DbClient,
  target: PreprodAccessTarget,
  enabled: boolean,
) {
  const changes = await db.preprodAccessChange.findMany({
    where: { targetType: target.type, targetId: target.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: RECENT_CHANGES,
  });
  const operators =
    changes.length === 0
      ? []
      : await db.user.findMany({
          where: { id: { in: [...new Set(changes.map((c) => c.operatorId))] } },
          select: { id: true, name: true },
        });
  const names = new Map(operators.map((user) => [user.id, user.name]));
  return {
    enabled,
    changes: changes.map((change) => ({
      id: change.id,
      createdAt: change.createdAt,
      enabled: change.enabled,
      reason: change.reason,
      operator: {
        id: change.operatorId,
        name: names.get(change.operatorId) ?? null,
      },
    })),
  };
}

/**
 * Switches the flag and records the change in one transaction, and answers
 * from that transaction: a target deleted at any point is 404 with nothing
 * written. A value the row already holds changes nothing and records nothing,
 * as a repeated refund does on the other operator audit tables; the condition
 * is in the update, so two equal requests at once record one change.
 */
export function setPreprodAccess(input: {
  target:
    | { type: "user"; where: { id: string } }
    | { type: "organization"; where: { slug: string } };
  enabled: boolean;
  operatorId: string;
  reason: string;
}) {
  const { target, enabled, operatorId, reason } = input;
  return prisma.$transaction(async (tx) => {
    const data = { preprodEnabled: enabled };
    const select = { id: true, preprodEnabled: true };
    let count: number;
    let current: { id: string; preprodEnabled: boolean } | null;
    if (target.type === "user") {
      const where = { ...target.where, preprodEnabled: !enabled };
      ({ count } = await tx.user.updateMany({ where, data }));
      current = await tx.user.findUnique({ where: target.where, select });
    } else {
      const where = { ...target.where, preprodEnabled: !enabled };
      ({ count } = await tx.organization.updateMany({ where, data }));
      current = await tx.organization.findUnique({
        where: target.where,
        select,
      });
    }
    if (!current) {
      throw notFound(
        target.type === "user" ? "User not found" : "Organization not found",
      );
    }
    const changed = { type: target.type, id: current.id };
    if (count > 0) {
      // Prisma stamps `createdAt` here, after the update and under its row
      // lock, so the newest record is the last switch; the column's own
      // default would be the transaction's start.
      await tx.preprodAccessChange.create({
        data: {
          targetType: changed.type,
          targetId: changed.id,
          enabled,
          operatorId,
          reason,
        },
      });
    }
    return preprodAccessOf(tx, changed, current.preprodEnabled);
  });
}

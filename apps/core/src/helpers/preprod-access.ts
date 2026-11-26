import { forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
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
  target: PreprodAccessTarget,
  enabled: boolean,
) {
  const changes = await prisma.preprodAccessChange.findMany({
    where: { targetType: target.type, targetId: target.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: RECENT_CHANGES,
  });
  const operators = await prisma.user.findMany({
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
 * Switches the flag and records the change in one transaction. A value the
 * row already holds changes nothing and records nothing, as a repeated refund
 * does on the other operator audit tables; the condition is in the update, so
 * two equal requests at once record one change.
 */
export async function setPreprodAccess(input: {
  target: PreprodAccessTarget;
  enabled: boolean;
  operatorId: string;
  reason: string;
}): Promise<void> {
  const { target, enabled, operatorId, reason } = input;
  await prisma.$transaction(async (tx) => {
    const args = {
      where: { id: target.id, preprodEnabled: !enabled },
      data: { preprodEnabled: enabled },
    };
    const { count } =
      target.type === "user"
        ? await tx.user.updateMany(args)
        : await tx.organization.updateMany(args);
    if (count === 0) return;
    await tx.preprodAccessChange.create({
      data: {
        targetType: target.type,
        targetId: target.id,
        enabled,
        operatorId,
        reason,
      },
    });
  });
}

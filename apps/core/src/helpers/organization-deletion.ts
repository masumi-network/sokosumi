import type { createPrismaClient } from "@sokosumi/database/client";
import { APIError } from "better-auth/api";

import {
  CalendarErasureBlockedError,
  eraseWorkspaceCalendarData,
  lockCalendarErasureUser,
  lockWorkspaceCalendarForErasure,
} from "@/helpers/calendar-erasure";
import { lockCalendarScope } from "@/helpers/calendar-locks";
import {
  evaluateOrganizationDeletion,
  throwIfOrganizationDeletionBlocked,
} from "@/helpers/deletion-evaluate";

type PrismaClient = ReturnType<typeof createPrismaClient>;

/** Evaluate, erase, and delete an Organization under one parent-first lock set. */
export async function prepareOrganizationForDeletion(
  organizationId: string,
  actorUserId: string,
  prisma: PrismaClient,
): Promise<string | null> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockCalendarErasureUser(tx, actorUserId))) {
        throw new APIError("BAD_REQUEST", {
          code: "ORGANIZATION_DELETION_CONCURRENT_CHANGE",
          message: "Your account changed. Retry organization deletion.",
        });
      }

      const lockedOrganization = await tx.$queryRaw<
        Array<{ id: string; stripeCustomerId: string | null }>
      >`
      SELECT id, "stripeCustomerId"
      FROM "organization"
      WHERE id = ${organizationId}
      FOR UPDATE
    `;
      const organization = lockedOrganization[0];
      if (!organization) {
        return null;
      }

      const workspace = await tx.workspace.findUnique({
        where: { organizationId },
        select: { id: true },
      });
      if (workspace && !(await lockCalendarScope(tx, workspace.id, []))) {
        throw new APIError("BAD_REQUEST", {
          code: "ORGANIZATION_DELETION_CONCURRENT_CHANGE",
          message: "The organization changed. Retry deletion.",
        });
      }

      const evaluation = await evaluateOrganizationDeletion(
        organizationId,
        actorUserId,
        tx,
      );
      throwIfOrganizationDeletionBlocked(evaluation);

      try {
        if (
          workspace &&
          (await lockWorkspaceCalendarForErasure(tx, workspace.id))
        ) {
          await eraseWorkspaceCalendarData(tx, workspace.id);
        }
        await tx.organization.deleteMany({ where: { id: organizationId } });
      } catch (error) {
        if (error instanceof CalendarErasureBlockedError) {
          throw new APIError("BAD_REQUEST", {
            code: "ORGANIZATION_DELETION_TASK_PAYMENT_BLOCKED",
            message:
              "A task payment blocks organization deletion. Resolve it and retry.",
          });
        }
        throw error;
      }

      return organization.stripeCustomerId;
    },
    // Erasure locks and deletes every Task, occurrence, link, payment and event
    // in the Workspace; Prisma's default 5 s budget would P2028 on large orgs.
    { maxWait: 5_000, timeout: 30_000 },
  );
}

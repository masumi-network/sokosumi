import * as Sentry from "@sentry/node";
import type { createPrismaClient } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { APIError } from "better-auth/api";

import {
  CalendarErasureBlockedError,
  type CalendarErasureCleanup,
  cleanupCalendarErasureResources,
  eraseWorkspaceCalendarData,
  findForeignWorkspaceX402Charge,
  lockCalendarErasureUser,
  lockWorkspaceCalendarForErasure,
} from "@/helpers/calendar-erasure";
import { lockCalendarScope } from "@/helpers/calendar-locks";
import {
  evaluateOrganizationDeletion,
  throwIfOrganizationDeletionBlocked,
} from "@/helpers/deletion-evaluate";

import { isPrismaTransactionConflict } from "@/helpers/prisma";
import { applyRulesAfterDelete } from "@/helpers/user-deletion-crossing-rules";
import {
  applyOrganizationRules,
  checkWorkspaceDeletion,
  refuseJobsInWorkspace,
} from "@/helpers/workspace-deletion-crossing-rules";

type PrismaClient = ReturnType<typeof createPrismaClient>;

/** Evaluate, erase, and delete an Organization under one parent-first lock set. */
export async function prepareOrganizationForDeletion(
  organizationId: string,
  actorUserId: string,
  prisma: PrismaClient,
): Promise<string | null> {
  let result;
  try {
    result = await prisma.$transaction(
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
      FROM ${sharedTable("organization")}
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
          { inTransaction: true },
        );
        throwIfOrganizationDeletionBlocked(evaluation);

        let cleanup: CalendarErasureCleanup = {
          scheduledEmails: [],
          taskFiles: [],
        };
        try {
          let candidates:
            | Awaited<ReturnType<typeof checkWorkspaceDeletion>>
            | undefined;
          if (
            workspace &&
            (await lockWorkspaceCalendarForErasure(tx, workspace.id))
          ) {
            // Organization erasure must not remove a surviving user's payment
            // evidence, including charges for tasks retained after membership ends.
            const foreignCharge = await findForeignWorkspaceX402Charge(
              tx,
              workspace.id,
              actorUserId,
            );
            if (foreignCharge) {
              Sentry.captureMessage(
                "Organization deletion would remove a task x402 payment charged to another user",
                {
                  level: "error",
                  tags: {
                    error_type:
                      "organization_deletion_x402_payment_foreign_charge",
                  },
                  extra: {
                    organizationId,
                    userId: actorUserId,
                    taskX402PaymentId: foreignCharge.id,
                    taskId: foreignCharge.taskId,
                    chargedUserId: foreignCharge.chargedUserId,
                    repair:
                      "No admin endpoint clears this. Repair payment ownership or move the task out of the organization before retrying deletion.",
                  },
                },
              );
              throw new APIError("BAD_REQUEST", {
                code: "TASK_X402_PAYMENT_BILLING_OWNER_MISMATCH",
                message:
                  "A task payment belongs to another user. Contact support to repair it, then retry organization deletion.",
              });
            }
            candidates = await checkWorkspaceDeletion(
              tx,
              workspace.id,
              "organization",
            );
            cleanup = await eraseWorkspaceCalendarData(tx, workspace.id);
          }
          if (workspace) {
            await refuseJobsInWorkspace(tx, workspace.id, "organization");
          }
          await tx.organization.deleteMany({ where: { id: organizationId } });
          if (candidates) await applyRulesAfterDelete(tx, candidates);
          await applyOrganizationRules(tx, organizationId);
        } catch (error) {
          if (error instanceof CalendarErasureBlockedError) {
            Sentry.captureMessage(
              "Organization deletion blocked by a task x402 payment",
              {
                level: "error",
                tags: {
                  error_type: "organization_deletion_blocked_by_x402_payment",
                },
                extra: {
                  organizationId,
                  userId: actorUserId,
                  taskX402PaymentId: error.paymentId,
                  blocker: error.blocker,
                  status: error.paymentStatus,
                  ...(error.blocker === "task_payment_pending"
                    ? {
                        resolveEndpoint: `POST /v1/admin/task-x402-payments/${error.paymentId}/resolve`,
                      }
                    : {}),
                },
              },
            );
            throw new APIError("BAD_REQUEST", {
              code: "ORGANIZATION_DELETION_TASK_PAYMENT_BLOCKED",
              message:
                "A task payment blocks organization deletion. Contact support, then retry deletion.",
            });
          }
          throw error;
        }

        return { stripeCustomerId: organization.stripeCustomerId, cleanup };
      },
      // Erasure locks and deletes every Task, occurrence, link, payment and event
      // in the Workspace; Prisma's default 5 s budget would P2028 on large orgs.
      { maxWait: 5_000, timeout: 30_000 },
    );
  } catch (error) {
    if (isPrismaTransactionConflict(error)) {
      throw new APIError("BAD_REQUEST", {
        code: "ORGANIZATION_DELETION_CONCURRENT_CHANGE",
        message:
          "The organization changed while deletion was being prepared. Retry deletion.",
      });
    }
    throw error;
  }
  if (!result) return null;
  await cleanupCalendarErasureResources(result.cleanup);
  return result.stripeCustomerId;
}

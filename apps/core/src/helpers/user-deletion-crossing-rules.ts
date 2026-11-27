import * as Sentry from "@sentry/node";
import { type Prisma, TaskVisibility } from "@sokosumi/database";
import {
  netTable,
  sharedTable,
  sharedType,
} from "@sokosumi/database/sql-tables";
import { APIError } from "better-auth/api";

import { type Network, networksThatAreOn } from "@/lib/network";

/**
 * What the foreign keys between a Network's schema and the shared one do when
 * an account is deleted, done by Core in every Network that is on: delete
 * where the key cascades, clear where it sets null, refuse where it restricts.
 * The keys this flow owns are the rows with "user" in
 * `src/lib/db/crossing-keys.ts`; each statement names its key. Every step
 * runs before the delete of its parent, so it holds with the keys in place
 * and without them. The one exception is `applyJobRules`, which follows the
 * delete of its Jobs: none of its keys restricts, and the delete itself must
 * decide which Jobs go. No rule is changed here, the ones that look wrong
 * included: each refusal names its follow-up.
 */
type Tx = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

type Refusal =
  | "ACCOUNT_DELETION_WORKSPACE_HAS_JOB"
  | "ACCOUNT_DELETION_SUBTASK_HAS_PAYMENT"
  | "ACCOUNT_DELETION_SOKO_BOT_HIRED_JOB";

const REFUSAL_MESSAGES: Record<Refusal, string> = {
  ACCOUNT_DELETION_WORKSPACE_HAS_JOB:
    "A Job in your personal workspace blocks account deletion. Contact support, then delete your account again.",
  ACCOUNT_DELETION_SUBTASK_HAS_PAYMENT:
    "A task payment on a subtask blocks account deletion. Contact support, then delete your account again.",
  ACCOUNT_DELETION_SOKO_BOT_HIRED_JOB:
    "A Job hired by one of your Soko Bots blocks account deletion. Contact support, then delete your account again.",
};

// The key's own error reached Sentry as an unhandled 500; the refusal is a
// 400, so it reports itself.
function refuse(
  code: Refusal,
  network: Network,
  ids: { userId?: string; workspaceId?: string; id: string },
): never {
  Sentry.captureMessage("Account deletion refused by a Network row", {
    level: "error",
    tags: { error_type: "user_deletion_refused_by_network_row" },
    extra: { code, network, ...ids },
  });
  throw new APIError("BAD_REQUEST", { code, message: REFUSAL_MESSAGES[code] });
}

/**
 * Tasks about to be deleted: `Job.taskId`, `task_payment_claim.taskEventId`
 * and `task_x402_payment.taskEventId` are cleared; a payment left on one of
 * `unsweptTaskIds` refuses, as `task_x402_payment.taskId` restricts.
 */
async function applyTaskRules(
  tx: Tx,
  taskIds: string[],
  unsweptTaskIds: string[],
  ids: { userId?: string; workspaceId?: string },
): Promise<void> {
  if (taskIds.length === 0) return;
  for (const network of networksThatAreOn()) {
    if (unsweptTaskIds.length > 0) {
      // Follow-up (ticket 26, decision D5): the payment sweep reaches the
      // Tasks this user owns, not the subtasks deleted with them.
      const [payment] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM ${netTable(network, "task_x402_payment")}
        WHERE "taskId" = ANY(${unsweptTaskIds})
        LIMIT 1
      `;
      if (payment) {
        refuse("ACCOUNT_DELETION_SUBTASK_HAS_PAYMENT", network, {
          ...ids,
          id: payment.id,
        });
      }
    }
    await tx.$executeRaw`
      UPDATE ${netTable(network, "Job")} SET "taskId" = NULL
      WHERE "taskId" = ANY(${taskIds})
    `;
    await tx.$executeRaw`
      UPDATE ${netTable(network, "task_payment_claim")} SET "taskEventId" = NULL
      WHERE "taskEventId" IN (
        SELECT "id" FROM ${sharedTable("taskEvent")} WHERE "taskId" = ANY(${taskIds})
      )
    `;
    await tx.$executeRaw`
      UPDATE ${netTable(network, "task_x402_payment")} SET "taskEventId" = NULL
      WHERE "taskEventId" IN (
        SELECT "id" FROM ${sharedTable("taskEvent")} WHERE "taskId" = ANY(${taskIds})
      )
    `;
  }
}

/**
 * Before a personal workspace's Tasks and Projects are erased. A Task takes
 * its subtasks with it, in whichever workspace they are; a Project takes its
 * Soko Bots.
 */
export async function applyPersonalWorkspaceRules(
  tx: Tx,
  workspaceId: string,
): Promise<void> {
  const tasks = await tx.$queryRaw<{ id: string; inWorkspace: boolean }[]>`
    WITH RECURSIVE doomed AS (
      SELECT "id" FROM ${sharedTable("task")} WHERE "workspaceId" = ${workspaceId}::uuid
      UNION
      SELECT child."id"
      FROM ${sharedTable("task")} AS child
      INNER JOIN doomed ON child."parentTaskId" = doomed."id"
    )
    SELECT task."id", task."workspaceId" = ${workspaceId}::uuid AS "inWorkspace"
    FROM ${sharedTable("task")} AS task
    INNER JOIN doomed ON doomed."id" = task."id"
    ORDER BY task."id" ASC
    FOR UPDATE OF task
  `;
  // The erasure sweeps the payments on this workspace's own Tasks, after its
  // lock refused the ones it must keep.
  await applyTaskRules(
    tx,
    tasks.map((task) => task.id),
    tasks.filter((task) => !task.inWorkspace).map((task) => task.id),
    { workspaceId },
  );

  const projects = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${sharedTable("project")} WHERE "workspaceId" = ${workspaceId}::uuid
  `;
  if (projects.length === 0) return;
  const projectIds = projects.map((project) => project.id);
  const sokoBots = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${sharedTable("soko_bot")} WHERE "projectId" = ANY(${projectIds}::uuid[])
    ORDER BY "id" ASC
    FOR UPDATE
  `;
  const sokoBotIds = sokoBots.map((sokoBot) => sokoBot.id);
  for (const network of networksThatAreOn()) {
    await applySokoBotRules(tx, network, sokoBotIds, { workspaceId });
    await tx.$executeRaw`
      DELETE FROM ${netTable(network, "credit_bucket")}
      WHERE "projectId" = ANY(${projectIds}::uuid[])
    `;
    await tx.$executeRaw`
      UPDATE ${netTable(network, "Job")} SET "projectId" = NULL
      WHERE "projectId" = ANY(${projectIds}::uuid[])
    `;
  }
}

/**
 * Soko Bots about to be deleted: a Job one of them hired refuses, as
 * `Job.creatorSokoBotId` restricts; their usage rows go, whoever was charged.
 */
async function applySokoBotRules(
  tx: Tx,
  network: Network,
  sokoBotIds: string[],
  ids: { userId?: string; workspaceId?: string },
): Promise<void> {
  if (sokoBotIds.length === 0) return;
  // Follow-up (ticket 26, decision D5): any Job a Soko Bot hired blocks the
  // account deletion, also one in the personal workspace that the deletion
  // would remove a few statements later.
  const [job] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${netTable(network, "Job")}
    WHERE "creatorSokoBotId" = ANY(${sokoBotIds}::uuid[])
    LIMIT 1
  `;
  if (job) {
    refuse("ACCOUNT_DELETION_SOKO_BOT_HIRED_JOB", network, {
      ...ids,
      id: job.id,
    });
  }
  // Follow-up (ticket 26, decision D5): these rows are named by no product
  // rule; the key removes them today.
  await tx.$executeRaw`
    DELETE FROM ${netTable(network, "soko_bot_usage")}
    WHERE "sokoBotId" = ANY(${sokoBotIds}::uuid[])
  `;
}

/** Before the private Tasks this user owns are deleted, with their subtasks. */
export async function applyPrivateTaskRules(
  tx: Tx,
  userId: string,
): Promise<void> {
  const tasks = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE doomed AS (
      SELECT "id" FROM ${sharedTable("task")}
      WHERE "ownerId" = ${userId}
        AND "visibility" = ${TaskVisibility.PRIVATE}::${sharedType("TaskVisibility")}
      UNION
      SELECT child."id"
      FROM ${sharedTable("task")} AS child
      INNER JOIN doomed ON child."parentTaskId" = doomed."id"
    )
    SELECT task."id"
    FROM ${sharedTable("task")} AS task
    INNER JOIN doomed ON doomed."id" = task."id"
    ORDER BY task."id" ASC
    FOR UPDATE OF task
  `;
  const taskIds = tasks.map((task) => task.id);
  await applyTaskRules(tx, taskIds, taskIds, { userId });
}

/**
 * After Jobs of one Network were deleted: the shared rows that pointed at
 * them. A delegation or schedule carries its Network (none means Mainnet); a
 * share is Mainnet's.
 */
export async function applyJobRules(
  tx: Tx,
  network: Network,
  jobIds: string[],
): Promise<void> {
  if (jobIds.length === 0) return;
  await tx.$executeRaw`
    UPDATE ${sharedTable("soko_bot_delegation")} SET "jobId" = NULL
    WHERE "jobId" = ANY(${jobIds}) AND COALESCE("network", 'mainnet') = ${network}
  `;
  await tx.$executeRaw`
    DELETE FROM ${sharedTable("soko_bot_schedule")}
    WHERE "jobId" = ANY(${jobIds}) AND COALESCE("network", 'mainnet') = ${network}
  `;
  if (network === "mainnet") {
    await tx.$executeRaw`
      DELETE FROM ${sharedTable("jobShare")} WHERE "jobId" = ANY(${jobIds})
    `;
  }
}

/**
 * Before the User row is deleted, with its personal workspaces and Soko Bots.
 * The workspaces' Projects are gone by now, and the lock on each workspace
 * keeps new ones out.
 */
export async function applyUserRules(tx: Tx, userId: string): Promise<void> {
  const workspaces = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${sharedTable("workspace")} WHERE "userId" = ${userId}
  `;
  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const sokoBots = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${sharedTable("soko_bot")}
    WHERE "userId" = ${userId} OR "workspaceId" = ANY(${workspaceIds}::uuid[])
    ORDER BY "id" ASC
    FOR UPDATE
  `;
  const sokoBotIds = sokoBots.map((sokoBot) => sokoBot.id);

  for (const network of networksThatAreOn()) {
    if (workspaceIds.length > 0) {
      // `Job.workspaceId` restricts. The deletion removed the Jobs of these
      // workspaces a moment ago, so only a Job created since can be here.
      const [job] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM ${netTable(network, "Job")}
        WHERE "workspaceId" = ANY(${workspaceIds}::uuid[])
        LIMIT 1
      `;
      if (job) {
        refuse("ACCOUNT_DELETION_WORKSPACE_HAS_JOB", network, {
          userId,
          id: job.id,
        });
      }
    }
    await applySokoBotRules(tx, network, sokoBotIds, { userId });

    // The shared rows that point at this user's transactions, before those go.
    await tx.$executeRaw`
      UPDATE ${sharedTable("taskEvent")} SET "transactionId" = NULL
      WHERE COALESCE("network", 'mainnet') = ${network}
        AND "transactionId" IN (
          SELECT "id" FROM ${netTable(network, "Transaction")} WHERE "userId" = ${userId}
        )
    `;
    if (network === "mainnet") {
      await tx.$executeRaw`
        UPDATE ${sharedTable("competitor_check")} SET "transactionId" = NULL
        WHERE "transactionId" IN (
          SELECT "id" FROM ${netTable(network, "Transaction")} WHERE "userId" = ${userId}
        )
      `;
      await tx.$executeRaw`
        UPDATE ${sharedTable("project_image_job")} SET "transactionId" = NULL
        WHERE "transactionId" IN (
          SELECT "id" FROM ${netTable(network, "Transaction")} WHERE "userId" = ${userId}
        )
      `;
      await tx.$executeRaw`
        UPDATE ${sharedTable("project_image_job")} SET "refundTransactionId" = NULL
        WHERE "refundTransactionId" IN (
          SELECT "id" FROM ${netTable(network, "Transaction")} WHERE "userId" = ${userId}
        )
      `;
      await tx.$executeRaw`
        UPDATE ${sharedTable("seo_audit_chat_turn")} SET "transactionId" = NULL
        WHERE "transactionId" IN (
          SELECT "id" FROM ${netTable(network, "Transaction")} WHERE "userId" = ${userId}
        )
      `;
    }
    await tx.$executeRaw`
      DELETE FROM ${netTable(network, "Transaction")} WHERE "userId" = ${userId}
    `;
    await tx.$executeRaw`
      DELETE FROM ${netTable(network, "credit_bucket")} WHERE "userId" = ${userId}
    `;
    await tx.$executeRaw`
      DELETE FROM ${netTable(network, "UserAgentRating")} WHERE "userId" = ${userId}
    `;
    await tx.$executeRaw`
      DELETE FROM ${netTable(network, "coworker_usage")} WHERE "userId" = ${userId}
    `;
    await tx.$executeRaw`
      DELETE FROM ${netTable(network, "soko_bot_usage")} WHERE "userId" = ${userId}
    `;
    await tx.$executeRaw`
      UPDATE ${netTable(network, "Job")} SET "ownerId" = NULL WHERE "ownerId" = ${userId}
    `;
    await tx.$executeRaw`
      UPDATE ${netTable(network, "Job")} SET "creatorUserId" = NULL
      WHERE "creatorUserId" = ${userId}
    `;
  }
}

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
 * `src/lib/db/crossing-keys.ts`; each statement names its key.
 *
 * One rule for all of them. A refusal is checked before its parent is
 * deleted. A delete or a clear runs after it, and only where the parent is
 * gone: on the rows a delete returned, or on candidates read beforehand
 * whose parent no longer exists. So a row that left in between (a subtask
 * detached, a Job moved) is not touched, and no lock is needed beyond the
 * flow's own. While the keys exist they have done the work at the parent's
 * delete, and every statement here changes no row: each function returns
 * its counts, which the tests hold at 0 with the keys in place.
 *
 * No rule is changed here, the ones that look wrong included: each refusal
 * names its follow-up.
 */
type Tx = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

/** Rows changed per statement, named by its key. */
export type RuleCounts = Record<string, number>;

/** Ids read before a delete, for the rules that follow it. */
export interface DeletionCandidates {
  taskIds: string[];
  taskEventIds: string[];
  projectIds: string[];
  sokoBotIds: string[];
}

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
 * A payment on one of `taskIds` refuses, as `task_x402_payment.taskId`
 * restricts.
 */
async function refuseOnPayments(
  tx: Tx,
  taskIds: string[],
  ids: { userId?: string; workspaceId?: string },
): Promise<void> {
  if (taskIds.length === 0) return;
  for (const network of networksThatAreOn()) {
    // Follow-up (ticket 26, decision D5): the payment sweep reaches the
    // Tasks this user owns, not the subtasks deleted with them.
    const [payment] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM ${netTable(network, "task_x402_payment")}
      WHERE "taskId" = ANY(${taskIds})
      LIMIT 1
    `;
    if (payment) {
      refuse("ACCOUNT_DELETION_SUBTASK_HAS_PAYMENT", network, {
        ...ids,
        id: payment.id,
      });
    }
  }
}

/**
 * A Job one of `sokoBotIds` hired refuses, as `Job.creatorSokoBotId`
 * restricts.
 */
async function refuseOnHiredJobs(
  tx: Tx,
  sokoBotIds: string[],
  ids: { userId?: string; workspaceId?: string },
): Promise<void> {
  if (sokoBotIds.length === 0) return;
  for (const network of networksThatAreOn()) {
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
  }
}

async function eventsOf(tx: Tx, taskIds: string[]): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const events = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${sharedTable("taskEvent")} WHERE "taskId" = ANY(${taskIds})
  `;
  return events.map((event) => event.id);
}

/**
 * Before a personal workspace's Tasks and Projects are erased: refuses where
 * a key would, and returns what `applyRulesAfterDelete` needs afterwards. A
 * Task takes its subtasks with it, in whichever workspace they are; a
 * Project takes its Soko Bots.
 */
export async function checkPersonalWorkspace(
  tx: Tx,
  workspaceId: string,
): Promise<DeletionCandidates> {
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
  `;
  const taskIds = tasks.map((task) => task.id);
  // The erasure sweeps the payments on this workspace's own Tasks, after its
  // lock refused the ones it must keep.
  await refuseOnPayments(
    tx,
    tasks.filter((task) => !task.inWorkspace).map((task) => task.id),
    { workspaceId },
  );

  const projects = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${sharedTable("project")} WHERE "workspaceId" = ${workspaceId}::uuid
  `;
  const projectIds = projects.map((project) => project.id);
  const sokoBots =
    projectIds.length === 0
      ? []
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM ${sharedTable("soko_bot")} WHERE "projectId" = ANY(${projectIds}::uuid[])
        `;
  const sokoBotIds = sokoBots.map((sokoBot) => sokoBot.id);
  await refuseOnHiredJobs(tx, sokoBotIds, { workspaceId });
  return {
    taskIds,
    taskEventIds: await eventsOf(tx, taskIds),
    projectIds,
    sokoBotIds,
  };
}

/** Before the private Tasks this user owns are deleted, with their subtasks. */
export async function checkPrivateTasks(
  tx: Tx,
  userId: string,
): Promise<DeletionCandidates> {
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
    SELECT "id" FROM doomed
  `;
  const taskIds = tasks.map((task) => task.id);
  await refuseOnPayments(tx, taskIds, { userId });
  return {
    taskIds,
    taskEventIds: await eventsOf(tx, taskIds),
    projectIds: [],
    sokoBotIds: [],
  };
}

/**
 * Before the User row is deleted, with its personal workspaces and Soko Bots.
 * The workspaces' Projects are gone by now, and the lock on each workspace
 * keeps new ones out.
 */
export async function checkUser(
  tx: Tx,
  userId: string,
): Promise<DeletionCandidates> {
  const workspaces = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${sharedTable("workspace")} WHERE "userId" = ${userId}
  `;
  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const sokoBots = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${sharedTable("soko_bot")}
    WHERE "userId" = ${userId} OR "workspaceId" = ANY(${workspaceIds}::uuid[])
  `;
  const sokoBotIds = sokoBots.map((sokoBot) => sokoBot.id);
  if (workspaceIds.length > 0) {
    for (const network of networksThatAreOn()) {
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
  }
  await refuseOnHiredJobs(tx, sokoBotIds, { userId });
  return { taskIds: [], taskEventIds: [], projectIds: [], sokoBotIds };
}

/**
 * After the delete that `candidates` were read for: the Network rows that
 * pointed at a Task, Task event, Project or Soko Bot which is gone now. One
 * that is still there keeps its rows.
 */
export async function applyRulesAfterDelete(
  tx: Tx,
  { taskIds, taskEventIds, projectIds, sokoBotIds }: DeletionCandidates,
): Promise<RuleCounts> {
  const counts: RuleCounts = {};
  const add = (key: string, rows: number) => {
    counts[key] = (counts[key] ?? 0) + rows;
  };
  for (const network of networksThatAreOn()) {
    if (taskIds.length > 0) {
      add(
        "Job.taskId",
        await tx.$executeRaw`
          UPDATE ${netTable(network, "Job")} AS job SET "taskId" = NULL
          WHERE job."taskId" = ANY(${taskIds})
            AND NOT EXISTS (
              SELECT 1 FROM ${sharedTable("task")} AS parent WHERE parent."id" = job."taskId"
            )
        `,
      );
    }
    if (taskEventIds.length > 0) {
      add(
        "task_payment_claim.taskEventId",
        await tx.$executeRaw`
          UPDATE ${netTable(network, "task_payment_claim")} AS claim SET "taskEventId" = NULL
          WHERE claim."taskEventId" = ANY(${taskEventIds})
            AND NOT EXISTS (
              SELECT 1 FROM ${sharedTable("taskEvent")} AS parent WHERE parent."id" = claim."taskEventId"
            )
        `,
      );
      add(
        "task_x402_payment.taskEventId",
        await tx.$executeRaw`
          UPDATE ${netTable(network, "task_x402_payment")} AS payment SET "taskEventId" = NULL
          WHERE payment."taskEventId" = ANY(${taskEventIds})
            AND NOT EXISTS (
              SELECT 1 FROM ${sharedTable("taskEvent")} AS parent WHERE parent."id" = payment."taskEventId"
            )
        `,
      );
    }
    if (projectIds.length > 0) {
      add(
        "credit_bucket.projectId",
        await tx.$executeRaw`
          DELETE FROM ${netTable(network, "credit_bucket")} AS bucket
          WHERE bucket."projectId" = ANY(${projectIds}::uuid[])
            AND NOT EXISTS (
              SELECT 1 FROM ${sharedTable("project")} AS parent WHERE parent."id" = bucket."projectId"
            )
        `,
      );
      add(
        "Job.projectId",
        await tx.$executeRaw`
          UPDATE ${netTable(network, "Job")} AS job SET "projectId" = NULL
          WHERE job."projectId" = ANY(${projectIds}::uuid[])
            AND NOT EXISTS (
              SELECT 1 FROM ${sharedTable("project")} AS parent WHERE parent."id" = job."projectId"
            )
        `,
      );
    }
    if (sokoBotIds.length > 0) {
      // Follow-up (ticket 26, decision D5): these rows are named by no
      // product rule; the key removes them today, whoever was charged.
      add(
        "soko_bot_usage.sokoBotId",
        await tx.$executeRaw`
          DELETE FROM ${netTable(network, "soko_bot_usage")} AS usage
          WHERE usage."sokoBotId" = ANY(${sokoBotIds}::uuid[])
            AND NOT EXISTS (
              SELECT 1 FROM ${sharedTable("soko_bot")} AS parent WHERE parent."id" = usage."sokoBotId"
            )
        `,
      );
    }
  }
  return counts;
}

/**
 * After Jobs of one Network were deleted: the shared rows that pointed at
 * them. `jobIds` are the ids the delete returned. A delegation or schedule
 * carries its Network (none means Mainnet); a share is Mainnet's.
 */
export async function applyJobRules(
  tx: Tx,
  network: Network,
  jobIds: string[],
): Promise<RuleCounts> {
  if (jobIds.length === 0) return {};
  return {
    "soko_bot_delegation.jobId": await tx.$executeRaw`
      UPDATE ${sharedTable("soko_bot_delegation")} SET "jobId" = NULL
      WHERE "jobId" = ANY(${jobIds}) AND COALESCE("network", 'mainnet') = ${network}
    `,
    "soko_bot_schedule.jobId": await tx.$executeRaw`
      DELETE FROM ${sharedTable("soko_bot_schedule")}
      WHERE "jobId" = ANY(${jobIds}) AND COALESCE("network", 'mainnet') = ${network}
    `,
    ...(network === "mainnet"
      ? {
          "jobShare.jobId": await tx.$executeRaw`
            DELETE FROM ${sharedTable("jobShare")} WHERE "jobId" = ANY(${jobIds})
          `,
        }
      : {}),
  };
}

/**
 * After the User row is deleted: the Network rows that pointed at it, while
 * no User with this id exists, and the rows of the Soko Bots that went with
 * it. The transactions return their ids, and the shared rows that pointed at
 * those follow.
 */
export async function applyUserRules(
  tx: Tx,
  userId: string,
  candidates: DeletionCandidates,
): Promise<RuleCounts> {
  const counts = await applyRulesAfterDelete(tx, candidates);
  const add = (key: string, rows: number) => {
    counts[key] = (counts[key] ?? 0) + rows;
  };
  for (const network of networksThatAreOn()) {
    const transactions = await tx.$queryRaw<{ id: string }[]>`
      DELETE FROM ${netTable(network, "Transaction")}
      WHERE "userId" = ${userId}
        AND NOT EXISTS (SELECT 1 FROM ${sharedTable("user")} WHERE "id" = ${userId})
      RETURNING "id"
    `;
    add("Transaction.userId", transactions.length);
    if (transactions.length > 0) {
      const transactionIds = transactions.map((transaction) => transaction.id);
      add(
        "taskEvent.transactionId",
        await tx.$executeRaw`
          UPDATE ${sharedTable("taskEvent")} SET "transactionId" = NULL
          WHERE COALESCE("network", 'mainnet') = ${network}
            AND "transactionId" = ANY(${transactionIds})
        `,
      );
      if (network === "mainnet") {
        add(
          "competitor_check.transactionId",
          await tx.$executeRaw`
            UPDATE ${sharedTable("competitor_check")} SET "transactionId" = NULL
            WHERE "transactionId" = ANY(${transactionIds})
          `,
        );
        add(
          "project_image_job.transactionId",
          await tx.$executeRaw`
            UPDATE ${sharedTable("project_image_job")} SET "transactionId" = NULL
            WHERE "transactionId" = ANY(${transactionIds})
          `,
        );
        add(
          "project_image_job.refundTransactionId",
          await tx.$executeRaw`
            UPDATE ${sharedTable("project_image_job")} SET "refundTransactionId" = NULL
            WHERE "refundTransactionId" = ANY(${transactionIds})
          `,
        );
        add(
          "seo_audit_chat_turn.transactionId",
          await tx.$executeRaw`
            UPDATE ${sharedTable("seo_audit_chat_turn")} SET "transactionId" = NULL
            WHERE "transactionId" = ANY(${transactionIds})
          `,
        );
      }
    }
    add(
      "credit_bucket.userId",
      await tx.$executeRaw`
        DELETE FROM ${netTable(network, "credit_bucket")}
        WHERE "userId" = ${userId}
          AND NOT EXISTS (SELECT 1 FROM ${sharedTable("user")} WHERE "id" = ${userId})
      `,
    );
    add(
      "UserAgentRating.userId",
      await tx.$executeRaw`
        DELETE FROM ${netTable(network, "UserAgentRating")}
        WHERE "userId" = ${userId}
          AND NOT EXISTS (SELECT 1 FROM ${sharedTable("user")} WHERE "id" = ${userId})
      `,
    );
    add(
      "coworker_usage.userId",
      await tx.$executeRaw`
        DELETE FROM ${netTable(network, "coworker_usage")}
        WHERE "userId" = ${userId}
          AND NOT EXISTS (SELECT 1 FROM ${sharedTable("user")} WHERE "id" = ${userId})
      `,
    );
    add(
      "soko_bot_usage.userId",
      await tx.$executeRaw`
        DELETE FROM ${netTable(network, "soko_bot_usage")}
        WHERE "userId" = ${userId}
          AND NOT EXISTS (SELECT 1 FROM ${sharedTable("user")} WHERE "id" = ${userId})
      `,
    );
    add(
      "Job.ownerId",
      await tx.$executeRaw`
        UPDATE ${netTable(network, "Job")} SET "ownerId" = NULL
        WHERE "ownerId" = ${userId}
          AND NOT EXISTS (SELECT 1 FROM ${sharedTable("user")} WHERE "id" = ${userId})
      `,
    );
    add(
      "Job.creatorUserId",
      await tx.$executeRaw`
        UPDATE ${netTable(network, "Job")} SET "creatorUserId" = NULL
        WHERE "creatorUserId" = ${userId}
          AND NOT EXISTS (SELECT 1 FROM ${sharedTable("user")} WHERE "id" = ${userId})
      `,
    );
  }
  return counts;
}

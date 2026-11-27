import { netTable, sharedTable } from "@sokosumi/database/sql-tables";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { APIError } from "better-auth/api";

import { conflict } from "@/helpers/error";
import {
  type DeletionCandidates,
  eventsOf,
  findJobHiredByBots,
  findJobInWorkspaces,
  findPaymentOnTasks,
  type RuleCounts,
  workspaceBotIds,
  workspaceProjectIds,
  workspaceTasksWithDescendants,
} from "@/helpers/user-deletion-crossing-rules";
import { networksThatAreOn } from "@/lib/network";

type Tx = Parameters<typeof workspaceProjectIds>[0];

const ORGANIZATION_REFUSALS = {
  workspaceJob: {
    code: "ORGANIZATION_DELETION_WORKSPACE_HAS_JOB",
    message:
      "A job in the organization workspace blocks deletion. Contact support, then retry deletion.",
  },
  hiredJob: {
    code: "ORGANIZATION_DELETION_SOKO_BOT_HIRED_JOB",
    message:
      "A job hired by an organization Soko Bot blocks deletion. Contact support, then retry deletion.",
  },
  subtaskPayment: {
    code: "ORGANIZATION_DELETION_SUBTASK_HAS_PAYMENT",
    message:
      "A task payment on a subtask blocks organization deletion. Contact support, then retry deletion.",
  },
};

type Refusal = keyof typeof ORGANIZATION_REFUSALS;
type Flow = "organization" | "personal workspace";

export function workspaceHasDependents() {
  return conflict(
    "Cannot delete a personal workspace that still has jobs or tasks",
    {
      kind: CORE_API_ERROR_KINDS.WORKSPACE_HAS_DEPENDENTS,
    },
  );
}

function refuse(flow: Flow, refusal: Refusal): never {
  if (flow === "personal workspace") throw workspaceHasDependents();
  throw new APIError("BAD_REQUEST", ORGANIZATION_REFUSALS[refusal]);
}

export async function refuseJobsInWorkspace(
  tx: Tx,
  workspaceId: string,
  flow: Flow,
) {
  for (const network of networksThatAreOn()) {
    if (await findJobInWorkspaces(tx, network, [workspaceId])) {
      refuse(flow, "workspaceJob");
    }
  }
}

/** Candidates for the keys owned by each workspace deletion in crossing-keys.ts. */
export async function checkWorkspaceDeletion(
  tx: Tx,
  workspaceId: string,
  flow: Flow,
): Promise<DeletionCandidates> {
  const projectIds = await workspaceProjectIds(tx, workspaceId);
  const sokoBotIds = await workspaceBotIds(tx, projectIds, [workspaceId]);
  const tasks =
    flow === "organization"
      ? await workspaceTasksWithDescendants(tx, workspaceId)
      : [];
  // Calendar erasure sweeps payments on Tasks in this workspace. A payment
  // on a cascading subtask outside the workspace still restricts its delete.
  const outsideTaskIds = tasks
    .filter(({ inWorkspace }) => !inWorkspace)
    .map(({ id }) => id);
  for (const network of networksThatAreOn()) {
    if (await findPaymentOnTasks(tx, network, outsideTaskIds)) {
      refuse(flow, "subtaskPayment");
    }
    if (await findJobHiredByBots(tx, network, sokoBotIds)) {
      refuse(flow, "hiredJob");
    }
  }
  const taskIds = tasks.map(({ id }) => id);
  return {
    taskIds,
    taskEventIds: await eventsOf(tx, taskIds),
    projectIds,
    sokoBotIds,
  };
}

/** After the Organization delete, mirror its keys for each enabled Network. */
export async function applyOrganizationRules(
  tx: Tx,
  organizationId: string,
): Promise<RuleCounts> {
  const counts: RuleCounts = {};
  const add = (key: string, rows: number) => {
    counts[key] = (counts[key] ?? 0) + rows;
  };
  for (const network of networksThatAreOn()) {
    add(
      "credit_bucket.organizationId",
      await tx.$executeRaw`
      DELETE FROM ${netTable(network, "credit_bucket")} AS bucket
      WHERE bucket."organizationId" = ANY(${[organizationId]})
        AND NOT EXISTS (
          SELECT 1 FROM ${sharedTable("organization")} AS parent WHERE parent."id" = bucket."organizationId"
        )
    `,
    );
    add(
      "Transaction.organizationId",
      await tx.$executeRaw`
      UPDATE ${netTable(network, "Transaction")} AS charge SET "organizationId" = NULL
      WHERE charge."organizationId" = ANY(${[organizationId]})
        AND NOT EXISTS (
          SELECT 1 FROM ${sharedTable("organization")} AS parent WHERE parent."id" = charge."organizationId"
        )
    `,
    );
    add(
      "Job.organizationId",
      await tx.$executeRaw`
      UPDATE ${netTable(network, "Job")} AS job SET "organizationId" = NULL
      WHERE job."organizationId" = ANY(${[organizationId]})
        AND NOT EXISTS (
          SELECT 1 FROM ${sharedTable("organization")} AS parent WHERE parent."id" = job."organizationId"
        )
    `,
    );
    add(
      "coworker_usage.organizationId",
      await tx.$executeRaw`
      UPDATE ${netTable(network, "coworker_usage")} AS usage SET "organizationId" = NULL
      WHERE usage."organizationId" = ANY(${[organizationId]})
        AND NOT EXISTS (
          SELECT 1 FROM ${sharedTable("organization")} AS parent WHERE parent."id" = usage."organizationId"
        )
    `,
    );
    add(
      "soko_bot_usage.organizationId",
      await tx.$executeRaw`
      UPDATE ${netTable(network, "soko_bot_usage")} AS usage SET "organizationId" = NULL
      WHERE usage."organizationId" = ANY(${[organizationId]})
        AND NOT EXISTS (
          SELECT 1 FROM ${sharedTable("organization")} AS parent WHERE parent."id" = usage."organizationId"
        )
    `,
    );
  }
  return counts;
}

import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";

import type { Network } from "@/lib/network";
import {
  insertRow,
  seedAgent,
  seedJob,
} from "@/test-fixtures/user-deletion-world";

export type WorkspaceDeletionFlow = "organization" | "personal workspace";
type Tx = Prisma.TransactionClient;
export const DELETION_FIXTURE_TIME = "2026-01-01T00:00:00";

export interface WorkspaceDeletionWorld {
  id(name: string): string;
  workspaceId: string;
  actorId: string;
  organizationId: string;
}

export function newWorkspaceDeletionWorld(
  flow: WorkspaceDeletionFlow,
): WorkspaceDeletionWorld {
  const ids = new Map<string, string>();
  const id = (name: string) => {
    const existing = ids.get(name);
    if (existing) return existing;
    const value = randomUUID();
    ids.set(name, value);
    return value;
  };
  return {
    id,
    workspaceId: id(
      flow === "organization" ? "org.workspace" : "ada.workspace",
    ),
    actorId: id("ada"),
    organizationId: id("org"),
  };
}

export async function seedWorkspaceDeletionWorld(
  tx: Tx,
  flow: WorkspaceDeletionFlow,
  networks: readonly Network[],
  world: WorkspaceDeletionWorld,
) {
  const { id, workspaceId } = world;
  const at = { updatedAt: DELETION_FIXTURE_TIME };
  for (const name of ["ada", "bob"]) {
    await insertRow(tx, sharedTable("user"), {
      id: id(name),
      name,
      email: `${id(name)}@example.test`,
      emailVerified: true,
      createdAt: DELETION_FIXTURE_TIME,
      ...at,
    });
    await insertRow(tx, sharedTable("workspace"), {
      id: id(`${name}.workspace`),
      userId: id(name),
      ...at,
    });
  }
  for (const [org, owner] of [
    ["org", "ada"],
    ["otherOrg", "bob"],
  ]) {
    await insertRow(tx, sharedTable("organization"), {
      id: id(org),
      name: org,
      slug: id(org),
    });
    await insertRow(tx, sharedTable("member"), {
      id: id(`${org}.member`),
      userId: id(owner),
      organizationId: id(org),
      role: "owner",
    });
    await insertRow(tx, sharedTable("workspace"), {
      id: id(`${org}.workspace`),
      organizationId: id(org),
      ...at,
    });
  }
  await insertRow(tx, sharedTable("vendor"), {
    id: id("vendor"),
    name: "Test vendor",
    slug: id("vendor"),
    ...at,
  });
  await insertRow(tx, sharedTable("coworker"), {
    id: id("coworker"),
    name: "Test coworker",
    slug: id("coworker"),
    vendorId: id("vendor"),
    ...at,
  });
  for (const name of ["project", "otherProject"]) {
    // The surviving Job starts in this Project. Moving the Project leaves a
    // database-accepted legacy Job link in another workspace.
    await insertRow(tx, sharedTable("project"), {
      id: id(name),
      workspaceId: id("otherOrg.workspace"),
      name,
      ...at,
    });
  }
  for (const [name, botWorkspaceId, project] of [
    ["bot.project", workspaceId, id("project")],
    ["bot.workspace", workspaceId, null],
    ["bot.other", id("otherOrg.workspace"), id("otherProject")],
  ] as const) {
    await insertRow(tx, sharedTable("soko_bot"), {
      id: id(name),
      workspaceId: botWorkspaceId,
      projectId: project,
      ...at,
    });
  }
  for (const [name, taskWorkspaceId, org] of [
    ...(flow === "organization" ? [["task", workspaceId, id("org")]] : []),
    ["otherTask", id("otherOrg.workspace"), id("otherOrg")],
  ]) {
    await insertRow(tx, sharedTable("task"), {
      id: id(name),
      name,
      workspaceId: taskWorkspaceId,
      organizationId: org,
      status: "COMPLETED",
      tagClassificationAvailableAt: DELETION_FIXTURE_TIME,
      ...at,
    });
    await insertRow(tx, sharedTable("taskEvent"), {
      id: id(`${name}.event`),
      taskId: id(name),
      ...at,
    });
  }
  for (const network of networks) {
    await seedAgent(tx, network, id("agent"));
    const targetOrg = network === "mainnet" ? id("org") : id("otherOrg");
    for (const [name, user, org] of [
      ["charge.twin", id("ada"), targetOrg],
      ["charge.botProject", id("bob"), id("otherOrg")],
      ["charge.botWorkspace", id("bob"), id("otherOrg")],
      ["charge.botOrg", id("bob"), id("org")],
      ["charge.other", id("bob"), id("otherOrg")],
      ["charge.otherOrg", id("bob"), id("otherOrg")],
      ["charge.pay", id("ada"), id("org")],
      ["charge.otherPay", id("bob"), id("otherOrg")],
    ]) {
      await insertRow(tx, netTable(network, "Transaction"), {
        id: id(name),
        userId: user,
        organizationId: org,
        amount: 10,
        ...at,
      });
    }
    for (const [name, source, owner, org, project] of [
      ["bucket.org", "charge.pay", null, id("org"), null],
      ["bucket.project", "charge.botProject", id("bob"), null, id("project")],
      ["bucket.other", "charge.other", id("bob"), null, id("otherProject")],
      ["bucket.otherOrg", "charge.otherOrg", null, id("otherOrg"), null],
    ] as const) {
      await insertRow(tx, netTable(network, "credit_bucket"), {
        id: id(name),
        sourceTransactionId: id(source),
        userId: owner,
        organizationId: org,
        projectId: project,
        amount: 10,
        ...at,
      });
    }
    for (const [name, charge, org, bot] of [
      ["usage.project", "charge.botProject", id("otherOrg"), "bot.project"],
      [
        "usage.workspace",
        "charge.botWorkspace",
        id("otherOrg"),
        "bot.workspace",
      ],
      ["usage.org", "charge.botOrg", id("org"), "bot.other"],
      ["usage.other", "charge.other", id("otherOrg"), "bot.other"],
    ]) {
      await insertRow(tx, netTable(network, "soko_bot_usage"), {
        id: id(name),
        userId: id("bob"),
        organizationId: org,
        sokoBotId: id(bot),
        transactionId: id(charge),
        idempotencyKey: id(name),
        cents: 1,
        ...at,
      });
    }
    for (const [name, charge, org, user] of [
      ["coworkerUsage.org", "charge.twin", id("org"), id("ada")],
      ["coworkerUsage.other", "charge.other", id("otherOrg"), id("bob")],
    ]) {
      await insertRow(tx, netTable(network, "coworker_usage"), {
        id: id(name),
        userId: user,
        organizationId: org,
        transactionId: id(charge),
        coworkerId: id("coworker"),
        idempotencyKey: id(name),
        cents: 1,
        ...at,
      });
    }
    for (const [name, org, project, task] of [
      [
        "job.twin",
        targetOrg,
        id("project"),
        flow === "organization" ? id("task") : null,
      ],
      ["job.other", id("otherOrg"), id("otherProject"), id("otherTask")],
      ["job.org", id("org"), null, null],
    ] as const) {
      await seedJob(tx, network, {
        id: id(name),
        agentId: id("agent"),
        ownerId: id("bob"),
        workspaceId: id("otherOrg.workspace"),
        organizationId: org,
        projectId: project,
        taskId: task,
      });
      await insertRow(tx, netTable(network, "jobEvent"), {
        id: id(`${name}.event`),
        jobId: id(name),
        status: "COMPLETED",
        ...at,
      });
    }
    if (flow === "organization") {
      await insertRow(tx, netTable(network, "task_payment_claim"), {
        id: id("claim"),
        taskEventId: id("task.event"),
        transactionId: id("charge.other"),
        network,
        blockchainIdentifier: id("claim"),
        status: "PURCHASED",
        purchasePayload: {},
        ...at,
      });
      await insertWorkspaceDeletionPayment(
        tx,
        network,
        world,
        "payment",
        "task",
        "charge.pay",
      );
      await insertWorkspaceDeletionPayment(
        tx,
        network,
        world,
        "payment.other",
        "otherTask",
        "charge.otherPay",
        "task.event",
      );
    }
  }
  await tx.$executeRaw`
    UPDATE ${sharedTable("project")} SET "workspaceId" = ${workspaceId}::uuid
    WHERE "id" = ${id("project")}::uuid
  `;
}

export async function insertWorkspaceDeletionPayment(
  tx: Tx,
  network: Network,
  { id }: WorkspaceDeletionWorld,
  name: string,
  task: string,
  charge: string,
  event?: string,
) {
  await insertRow(tx, netTable(network, "task_x402_payment"), {
    id: id(name),
    updatedAt: DELETION_FIXTURE_TIME,
    idempotencyKey: id(name),
    caip2Network: "test",
    asset: "test",
    amount: "1",
    payTo: "test",
    agentId: id("agent"),
    status: "VERIFIED",
    taskId: id(task),
    transactionId: id(charge),
    ...(event ? { taskEventId: id(event) } : {}),
  });
}

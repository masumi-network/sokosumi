import { randomUUID } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";

import type { Network } from "@/lib/network";

type Tx = Pick<Prisma.TransactionClient, "$executeRaw">;
type Row = Record<string, unknown>;

const AT = "2026-01-01T00:00:00";

/**
 * Inserts `row`, with PostgreSQL casting each value to its column's type and
 * filling the columns left out from their defaults.
 */
export async function insertRow(
  tx: Tx,
  table: PrismaRaw.Sql,
  row: Row,
): Promise<void> {
  const columns = PrismaRaw.raw(
    Object.keys(row)
      .map((column) => `"${column}"`)
      .join(", "),
  );
  await tx.$executeRaw`
    INSERT INTO ${table} (${columns})
    SELECT ${columns} FROM jsonb_populate_record(NULL::${table}, ${JSON.stringify(row)}::jsonb)
  `;
}

/** One id per name, the same on every Network. */
function namedIds() {
  const ids = new Map<string, string>();
  return (name: string) => {
    let id = ids.get(name);
    if (!id) {
      id = randomUUID();
      ids.set(name, id);
    }
    return id;
  };
}

/** A free Agent on `network`, with its pricing row under the same id. */
export async function seedAgent(
  tx: Tx,
  network: Network,
  agentId: string,
): Promise<void> {
  await insertRow(tx, netTable(network, "AgentPricing"), {
    id: agentId,
    updatedAt: AT,
    pricingType: "FREE",
  });
  await insertRow(tx, netTable(network, "Agent"), {
    id: agentId,
    updatedAt: AT,
    blockchainIdentifier: `chain-${agentId}`,
    name: "Agent",
    lastUptimeCheck: AT,
    uptimeCount: 1,
    uptimeCheckCount: 1,
    pricingId: agentId,
    isShown: true,
  });
}

/** A free Job on `network`; `row` holds at least its workspace. */
export async function seedJob(
  tx: Tx,
  network: Network,
  row: Row & { id: string; agentId: string; workspaceId: string },
): Promise<void> {
  await insertRow(tx, netTable(network, "Job"), {
    updatedAt: AT,
    agentJobId: row.id,
    jobType: "FREE",
    ...row,
  });
}

export interface DeletionWorld {
  /** The account to delete. */
  ada: string;
  /** A colleague who stays, with rows of their own beside Ada's. */
  bob: string;
  id(name: string): string;
}

/**
 * Ada, with at least one row behind every foreign key between a Network and
 * the shared schema that her account deletion fires, and Bob, whose rows must
 * all survive. The Network rows are seeded on each of `networks` under the
 * same ids, so a shared row that points into a Network is valid on all of
 * them. Nothing here blocks the deletion: `seedDeletionBlocker` adds that.
 */
export async function seedDeletionWorld(
  tx: Tx,
  networks: readonly Network[],
): Promise<DeletionWorld> {
  const id = namedIds();
  const ada = id("ada");
  const bob = id("bob");
  const personal = id("workspace.personal");
  const shared = id("workspace.organization");
  const organizationId = id("organization");

  for (const user of [ada, bob]) {
    await insertRow(tx, sharedTable("user"), {
      id: user,
      name: user === ada ? "Ada" : "Bob",
      email: `${user}@example.test`,
      emailVerified: true,
      createdAt: AT,
      updatedAt: AT,
    });
  }
  await insertRow(tx, sharedTable("organization"), {
    id: organizationId,
    name: "Acme",
    slug: `acme-${organizationId}`,
  });
  await insertRow(tx, sharedTable("member"), {
    id: id("member.ada"),
    userId: ada,
    organizationId,
    role: "member",
  });
  await insertRow(tx, sharedTable("member"), {
    id: id("member.bob"),
    userId: bob,
    organizationId,
    role: "owner",
  });
  await insertRow(tx, sharedTable("workspace"), {
    id: personal,
    updatedAt: AT,
    userId: ada,
  });
  await insertRow(tx, sharedTable("workspace"), {
    id: shared,
    updatedAt: AT,
    organizationId,
  });
  await insertRow(tx, sharedTable("vendor"), {
    id: id("vendor"),
    updatedAt: AT,
    name: "Vendor",
    slug: `vendor-${id("vendor")}`,
  });
  await insertRow(tx, sharedTable("coworker"), {
    id: id("coworker"),
    updatedAt: AT,
    name: "Coworker",
    slug: `coworker-${id("coworker")}`,
    vendorId: id("vendor"),
  });
  for (const [name, workspaceId] of [
    ["project.personal", personal],
    ["project.organization", shared],
  ]) {
    await insertRow(tx, sharedTable("project"), {
      id: id(name),
      updatedAt: AT,
      workspaceId,
      name,
    });
  }
  // Deleted with Ada: the bot of her personal Project, and the one she owns
  // in the Organization. Bob's stays.
  for (const [name, row] of Object.entries({
    "sokoBot.project": {
      workspaceId: personal,
      projectId: id("project.personal"),
    },
    "sokoBot.ada": { workspaceId: shared, userId: ada },
    "sokoBot.bob": { workspaceId: shared, userId: bob },
  })) {
    await insertRow(tx, sharedTable("soko_bot"), {
      id: id(name),
      updatedAt: AT,
      ...row,
    });
  }

  const organizationTask = { workspaceId: shared, organizationId };
  for (const [name, row] of Object.entries({
    "task.personal": { workspaceId: personal, ownerId: ada },
    "task.personalChild": {
      workspaceId: personal,
      ownerId: ada,
      parentTaskId: id("task.personal"),
      position: 1,
    },
    "task.private": {
      ...organizationTask,
      ownerId: ada,
      visibility: "PRIVATE",
    },
    "task.public": { ...organizationTask, ownerId: ada, creatorUserId: ada },
    "task.bob": { ...organizationTask, ownerId: bob, creatorUserId: bob },
  })) {
    await insertRow(tx, sharedTable("task"), {
      id: id(name),
      updatedAt: AT,
      name,
      ...row,
    });
    await insertRow(tx, sharedTable("taskEvent"), {
      id: id(name.replace("task.", "event.")),
      updatedAt: AT,
      taskId: id(name),
    });
  }

  // Two subtasks a trigger refuses today, written with triggers off: Bob's
  // subtask of Ada's private Task, and a subtask of her personal Task in
  // another workspace. The key from a subtask to its parent takes both along
  // all the same, so the rules must reach them.
  await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
  for (const [name, row] of Object.entries({
    "task.privateChild": {
      ownerId: bob,
      visibility: "PRIVATE",
      parentTaskId: id("task.private"),
    },
    "task.strayChild": { ownerId: bob, parentTaskId: id("task.personal") },
  })) {
    await insertRow(tx, sharedTable("task"), {
      id: id(name),
      updatedAt: AT,
      name,
      position: 2,
      ...organizationTask,
      ...row,
    });
    await insertRow(tx, sharedTable("taskEvent"), {
      id: id(name.replace("task.", "event.")),
      updatedAt: AT,
      taskId: id(name),
    });
  }
  await tx.$executeRaw`SET LOCAL session_replication_role = origin`;

  for (const network of networks) {
    await seedNetworkRows(tx, network, id);
  }

  // Shared rows that point into Mainnet, at rows of Ada's that go.
  await insertRow(tx, sharedTable("competitor_check"), {
    id: id("competitorCheck"),
    projectId: id("project.organization"),
    day: "2026-01-01",
    transactionId: id("transaction.adaSpend"),
  });
  await insertRow(tx, sharedTable("project_image_job"), {
    id: id("imageJob"),
    updatedAt: AT,
    projectId: id("project.organization"),
    workspaceId: shared,
    requestedByUserId: bob,
    kind: "GENERATE",
    model: "test",
    prompt: "test",
    settings: {},
    idempotencyKey: id("imageJob"),
    transactionId: id("transaction.adaSpend"),
    refundTransactionId: id("transaction.adaGrant"),
  });
  await insertRow(tx, sharedTable("jobShare"), {
    id: id("share"),
    updatedAt: AT,
    token: id("share"),
    jobId: id("job.personal"),
  });
  await insertRow(tx, sharedTable("seo_audit"), {
    id: id("seoAudit"),
    updatedAt: AT,
    workspaceId: shared,
    name: "test",
    createdById: bob,
  });
  await insertRow(tx, sharedTable("seo_audit_chat_turn"), {
    id: id("seoTurn"),
    auditId: id("seoAudit"),
    userId: bob,
    idempotencyKey: id("seoTurn"),
    requestHash: "test",
    question: "test",
    scopeSnapshot: {},
    model: "test",
    leaseExpiresAt: AT,
    transactionId: id("transaction.adaSpend"),
  });
  await insertRow(tx, sharedTable("soko_bot_turn"), {
    id: id("turn"),
    updatedAt: AT,
    sokoBotId: id("sokoBot.bob"),
    workspaceId: shared,
    source: "CHAT",
    clientTurnId: id("turn"),
    userMessage: "test",
    capabilityNames: [],
    deadlineAt: AT,
  });
  // A shared row with a Network holds that Network's name; none is Mainnet.
  for (const network of networks) {
    const tag = network === "mainnet" ? null : network;
    await insertRow(tx, sharedTable("soko_bot_delegation"), {
      id: id(`delegation.${network}`),
      updatedAt: AT,
      turnId: id("turn"),
      toolCallId: id(`delegation.${network}`),
      kind: "JOB",
      action: "test",
      jobId: id("job.personal"),
      network: tag,
    });
    await insertRow(tx, sharedTable("soko_bot_schedule"), {
      id: id(`schedule.${network}`),
      updatedAt: AT,
      sokoBotId: id("sokoBot.bob"),
      workspaceId: shared,
      name: "test",
      timezone: "UTC",
      cronExpression: "* * * * *",
      prompt: "test",
      nextRunAt: AT,
      jobId: id("job.private"),
      network: tag,
    });
    await insertRow(tx, sharedTable("taskEvent"), {
      id: id(`event.charged.${network}`),
      updatedAt: AT,
      taskId: id("task.bob"),
      transactionId: id("transaction.adaSpend"),
      network: tag,
    });
  }

  return { ada, bob, id };
}

async function seedNetworkRows(
  tx: Tx,
  network: Network,
  id: (name: string) => string,
): Promise<void> {
  const ada = id("ada");
  const bob = id("bob");
  const personal = id("workspace.personal");
  const shared = id("workspace.organization");
  const organizationId = id("organization");
  const agentId = id("agent");

  await seedAgent(tx, network, agentId);

  // Bob's transactions carry the rows that must go for another reason than
  // their own transaction, so each key is met alone.
  const transaction = (name: string, userId: string) =>
    insertRow(tx, netTable(network, "Transaction"), {
      id: id(name),
      updatedAt: AT,
      amount: 1,
      userId,
    });
  for (const name of ["adaSpend", "adaGrant", "adaClaim", "adaPayment"]) {
    await transaction(`transaction.${name}`, ada);
  }
  await transaction("transaction.adaPersonalPayment", ada);
  for (const name of "abcdefghijklmn") {
    await transaction(`transaction.bob.${name}`, bob);
  }

  for (const [name, row] of Object.entries({
    "bucket.adaGrant": {
      userId: ada,
      sourceTransactionId: id("transaction.adaGrant"),
    },
    "bucket.ada": {
      userId: ada,
      sourceTransactionId: id("transaction.bob.a"),
    },
    // No product rule names it: a bucket of Bob's on Ada's personal Project.
    "bucket.project": {
      userId: bob,
      projectId: id("project.personal"),
      sourceTransactionId: id("transaction.bob.b"),
    },
    "bucket.bob": {
      userId: bob,
      sourceTransactionId: id("transaction.bob.c"),
    },
  })) {
    await insertRow(tx, netTable(network, "credit_bucket"), {
      id: id(name),
      updatedAt: AT,
      amount: 10,
      ...row,
    });
  }
  for (const [name, row] of Object.entries({
    "consumption.adaSpend": {
      bucketId: id("bucket.bob"),
      transactionId: id("transaction.adaSpend"),
    },
    "consumption.adaBucket": {
      bucketId: id("bucket.ada"),
      transactionId: id("transaction.bob.d"),
    },
    "consumption.bob": {
      bucketId: id("bucket.bob"),
      transactionId: id("transaction.bob.d"),
    },
  })) {
    await insertRow(tx, netTable(network, "credit_consumption"), {
      id: id(name),
      amount: 1,
      ...row,
    });
  }
  for (const user of [ada, bob]) {
    await insertRow(tx, netTable(network, "UserAgentRating"), {
      id: id(`rating.${user}`),
      updatedAt: AT,
      rating: 4,
      userId: user,
      agentId,
    });
  }
  for (const [name, row] of Object.entries({
    "coworkerUsage.ada": {
      userId: ada,
      transactionId: id("transaction.bob.e"),
    },
    "coworkerUsage.bob": {
      userId: bob,
      transactionId: id("transaction.bob.f"),
    },
  })) {
    await insertRow(tx, netTable(network, "coworker_usage"), {
      id: id(name),
      updatedAt: AT,
      idempotencyKey: id(name),
      coworkerId: id("coworker"),
      cents: 1,
      ...row,
    });
  }
  for (const [name, row] of Object.entries({
    "sokoBotUsage.ada": {
      userId: ada,
      sokoBotId: id("sokoBot.bob"),
      transactionId: id("transaction.bob.g"),
    },
    // Charged to Bob, on Ada's two bots: they go with the bots.
    "sokoBotUsage.projectBot": {
      userId: bob,
      sokoBotId: id("sokoBot.project"),
      transactionId: id("transaction.bob.h"),
    },
    "sokoBotUsage.adaBot": {
      userId: bob,
      sokoBotId: id("sokoBot.ada"),
      transactionId: id("transaction.bob.i"),
    },
    "sokoBotUsage.bob": {
      userId: bob,
      sokoBotId: id("sokoBot.bob"),
      transactionId: id("transaction.bob.j"),
    },
  })) {
    await insertRow(tx, netTable(network, "soko_bot_usage"), {
      id: id(name),
      updatedAt: AT,
      idempotencyKey: id(name),
      cents: 1,
      ...row,
    });
  }

  const organizationJob = { workspaceId: shared, organizationId };
  for (const [name, row] of Object.entries({
    // Deleted: in her personal workspace, or on her private Task.
    "job.personal": { workspaceId: personal, ownerId: ada },
    "job.private": {
      ...organizationJob,
      ownerId: ada,
      taskId: id("task.private"),
    },
    // Kept, without its Owner and Creator.
    "job.public": {
      ...organizationJob,
      ownerId: ada,
      creatorUserId: ada,
      taskId: id("task.public"),
    },
    // Bob's Jobs on a Task or Project that goes: kept, detached.
    "job.onPrivateChild": {
      ...organizationJob,
      ownerId: bob,
      taskId: id("task.privateChild"),
    },
    "job.onPersonalTask": {
      ...organizationJob,
      ownerId: bob,
      taskId: id("task.personalChild"),
    },
    "job.onStrayChild": {
      ...organizationJob,
      ownerId: bob,
      taskId: id("task.strayChild"),
    },
    // A trigger keeps a Job's Project in the Job's workspace, so this one is
    // written with triggers off; the key clears it all the same.
    "job.onPersonalProject": {
      ...organizationJob,
      ownerId: bob,
      projectId: id("project.personal"),
    },
    "job.bob": { ...organizationJob, ownerId: bob, creatorUserId: bob },
  })) {
    const stray = name === "job.onPersonalProject";
    if (stray) {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    }
    await insertRow(tx, netTable(network, "Job"), {
      id: id(name),
      updatedAt: AT,
      name,
      agentId,
      agentJobId: id(name),
      jobType: "FREE",
      ...row,
    });
    if (stray) {
      await tx.$executeRaw`SET LOCAL session_replication_role = origin`;
    }
    await insertRow(tx, netTable(network, "jobEvent"), {
      id: id(name.replace("job.", "jobEvent.")),
      updatedAt: AT,
      jobId: id(name),
    });
  }

  for (const [name, row] of Object.entries({
    // Terminal, on Ada's charge: swept.
    "claim.terminal": {
      status: "PURCHASED",
      transactionId: id("transaction.adaClaim"),
    },
    // Bob's, pointing at events of Tasks that go: kept, detached.
    "claim.onPrivateEvent": {
      status: "PURCHASED",
      transactionId: id("transaction.bob.k"),
      taskEventId: id("event.privateChild"),
    },
    "claim.onPersonalEvent": {
      status: "PURCHASED",
      transactionId: id("transaction.bob.l"),
      taskEventId: id("event.personal"),
    },
  })) {
    await insertRow(tx, netTable(network, "task_payment_claim"), {
      id: id(name),
      updatedAt: AT,
      network: "preprod",
      blockchainIdentifier: id(name),
      purchasePayload: {},
      ...row,
    });
  }
  for (const [name, row] of Object.entries({
    // Terminal, on Ada's Tasks: swept by the account, and by the workspace.
    "payment.private": {
      taskId: id("task.private"),
      transactionId: id("transaction.adaPayment"),
      taskEventId: id("event.private"),
    },
    "payment.personal": {
      taskId: id("task.personal"),
      transactionId: id("transaction.adaPersonalPayment"),
    },
    // Bob's, pointing at events of Tasks that go: kept, detached.
    "payment.onPrivateEvent": {
      taskId: id("task.bob"),
      transactionId: id("transaction.bob.m"),
      taskEventId: id("event.privateChild"),
    },
    "payment.onPersonalEvent": {
      taskId: id("task.bob"),
      transactionId: id("transaction.bob.n"),
      taskEventId: id("event.personalChild"),
    },
  })) {
    await insertRow(tx, netTable(network, "task_x402_payment"), {
      id: id(name),
      updatedAt: AT,
      idempotencyKey: id(name),
      caip2Network: "test",
      asset: "test",
      amount: "1",
      payTo: "test",
      agentId,
      status: "VERIFIED",
      ...row,
    });
  }
}

export type DeletionBlocker =
  | "job in the personal workspace"
  | "payment on a subtask"
  | "job hired by a Soko Bot"
  | "job hired by the personal Project's Soko Bot, in the personal workspace";

/**
 * Adds to a seeded world one row that the account deletion must refuse on,
 * on `network`. Each is a row the deletion's own sweeps do not reach.
 */
export async function seedDeletionBlocker(
  tx: Tx,
  network: Network,
  world: DeletionWorld,
  blocker: DeletionBlocker,
): Promise<void> {
  const { id } = world;
  const job = (row: Row) =>
    insertRow(tx, netTable(network, "Job"), {
      id: id("blocker"),
      updatedAt: AT,
      agentId: id("agent"),
      agentJobId: id("blocker"),
      jobType: "FREE",
      workspaceId: id("workspace.organization"),
      ...row,
    });
  if (blocker === "job hired by a Soko Bot") {
    await job({ creatorSokoBotId: id("sokoBot.ada") });
  } else if (
    blocker ===
    "job hired by the personal Project's Soko Bot, in the personal workspace"
  ) {
    // The deletion removes this Job itself, but only after the Project.
    await job({
      workspaceId: id("workspace.personal"),
      creatorSokoBotId: id("sokoBot.project"),
    });
  } else if (blocker === "payment on a subtask") {
    // Bob's payment on his subtask of Ada's private Task.
    await insertRow(tx, netTable(network, "task_x402_payment"), {
      id: id("blocker"),
      updatedAt: AT,
      idempotencyKey: id("blocker"),
      caip2Network: "test",
      asset: "test",
      amount: "1",
      payTo: "test",
      agentId: id("agent"),
      status: "VERIFIED",
      taskId: id("task.privateChild"),
      transactionId: id("transaction.bob.a"),
    });
  } else {
    // Only a Job that appears after the deletion removed the workspace's
    // Jobs can block here, so the test adds it at that moment.
    await job({ workspaceId: id("workspace.personal") });
  }
}

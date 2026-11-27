import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";

import type { Network } from "@/lib/network";
import {
  insertRow,
  seedAgent,
  seedJob,
} from "@/test-fixtures/user-deletion-world";

type Tx = Pick<Prisma.TransactionClient, "$executeRaw">;
const AT = "2026-01-01T00:00:00";

/**
 * What points at the Soko Bot being deleted in every Network: nothing (it
 * goes), a usage row or a Job it hired (each keeps the tombstone).
 */
export type SokoBotDeletionCase = "nothing" | "usage" | "job";

export interface SokoBotDeletionWorld {
  id(name: string): string;
  /** The bot `deleteSokoBot` deletes. */
  sokoBotId: string;
  /** The Project of `bot.project`, which a race deletes beside the bot. */
  projectId: string;
}

export function newSokoBotDeletionWorld(): SokoBotDeletionWorld {
  const ids = new Map<string, string>();
  const id = (name: string) => {
    let value = ids.get(name);
    if (!value) {
      value = randomUUID();
      ids.set(name, value);
    }
    return value;
  };
  return { id, sokoBotId: id("bot"), projectId: id("project") };
}

/**
 * Ada's workspace with three bots: `bot` (the Soko Bot deletion's),
 * `bot.project` in `project`, and `bot.other` in
 * `otherProject`, whose rows must all survive. Each Network holds a row
 * behind every key of the flow, under the same ids.
 */
export async function seedSokoBotDeletionWorld(
  tx: Tx,
  networks: readonly Network[],
  world: SokoBotDeletionWorld,
  pointing: SokoBotDeletionCase,
) {
  const { id } = world;
  const at = { updatedAt: AT };
  await insertRow(tx, sharedTable("user"), {
    id: id("ada"),
    name: "ada",
    email: `${id("ada")}@example.test`,
    emailVerified: true,
    createdAt: AT,
    ...at,
  });
  await insertRow(tx, sharedTable("workspace"), {
    id: id("workspace"),
    userId: id("ada"),
    ...at,
  });
  for (const name of ["project", "otherProject"]) {
    await insertRow(tx, sharedTable("project"), {
      id: id(name),
      workspaceId: id("workspace"),
      name,
      ...at,
    });
  }
  for (const [name, user, project] of [
    ["bot", id("ada"), null],
    ["bot.project", null, id("project")],
    ["bot.other", null, id("otherProject")],
  ] as const) {
    await insertRow(tx, sharedTable("soko_bot"), {
      id: id(name),
      userId: user,
      workspaceId: id("workspace"),
      projectId: project,
      ...at,
    });
  }
  for (const network of networks) {
    await addSokoBotDeletionNetworkRows(tx, network, world, pointing);
  }
}

export async function addSokoBotDeletionNetworkRows(
  tx: Tx,
  network: Network,
  { id }: SokoBotDeletionWorld,
  pointing: SokoBotDeletionCase,
) {
  const at = { updatedAt: AT };
  await seedAgent(tx, network, id("agent"));
  for (const name of ["charge.project", "charge.other", "charge.bot"]) {
    await insertRow(tx, netTable(network, "Transaction"), {
      id: id(name),
      userId: id("ada"),
      amount: 10,
      ...at,
    });
  }
  for (const [name, charge, project] of [
    ["bucket.project", "charge.project", id("project")],
    ["bucket.other", "charge.other", id("otherProject")],
  ]) {
    await insertRow(tx, netTable(network, "credit_bucket"), {
      id: id(name),
      sourceTransactionId: id(charge),
      userId: id("ada"),
      projectId: project,
      amount: 10,
      ...at,
    });
  }
  for (const [name, charge, bot] of [
    ["usage.project", "charge.project", "bot.project"],
    ["usage.other", "charge.other", "bot.other"],
    ...(pointing === "usage" ? [["usage.bot", "charge.bot", "bot"]] : []),
  ]) {
    await insertRow(tx, netTable(network, "soko_bot_usage"), {
      id: id(name),
      userId: id("ada"),
      sokoBotId: id(bot),
      transactionId: id(charge),
      idempotencyKey: id(name),
      cents: 1,
      ...at,
    });
  }
  const jobs: [string, string | null, string | null][] = [
    ["job.project", id("project"), null],
    ["job.other", id("otherProject"), id("bot.other")],
  ];
  if (pointing === "job") jobs.push(["job.bot", null, id("bot")]);
  for (const [name, project, creator] of jobs) {
    await seedJob(tx, network, {
      id: id(name),
      agentId: id("agent"),
      ownerId: id("ada"),
      workspaceId: id("workspace"),
      projectId: project,
      creatorSokoBotId: creator,
    });
  }
}

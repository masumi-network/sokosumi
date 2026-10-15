import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  buildNotResponsibleUserWhere,
  buildResponsibleUserMatchingWhere,
  buildResponsibleUserSql,
  buildResponsibleUserWhere,
} from "./task-visibility";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

type Tx = Prisma.TransactionClient;

async function createPerson(tx: Tx) {
  const id = randomUUID();
  await tx.user.create({
    data: {
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return id;
}

/** One Task per way of naming a person, by name. */
async function seedTasks(tx: Tx) {
  const ada = await createPerson(tx);
  const bob = await createPerson(tx);
  const workspaceId = randomUUID();
  await tx.workspace.create({ data: { id: workspaceId, userId: ada } });
  const vendorId = randomUUID();
  const coworkerId = randomUUID();
  await tx.vendor.create({
    data: { id: vendorId, name: "Vendor", slug: `vendor-${vendorId}` },
  });
  await tx.coworker.create({
    data: {
      id: coworkerId,
      name: "Coworker",
      slug: `coworker-${coworkerId}`,
      vendorId,
    },
  });
  const rows: Array<[string, Partial<Prisma.TaskUncheckedCreateInput>]> = [
    ["owned by ada", { ownerId: ada, creatorUserId: ada }],
    ["owned by bob, made by ada", { ownerId: bob, creatorUserId: ada }],
    ["made by ada", { creatorUserId: ada }],
    [
      "asked by ada, owned by bob",
      { ownerId: bob, creatorCoworkerId: coworkerId, requestedByUserId: ada },
    ],
    ["asked by ada", { creatorCoworkerId: coworkerId, requestedByUserId: ada }],
    ["asked by bob", { creatorCoworkerId: coworkerId, requestedByUserId: bob }],
    ["made by a deleted person", {}],
  ];
  const ids = new Map<string, string>();
  for (const [name, columns] of rows) {
    const task = await tx.task.create({
      data: { name, workspaceId, ...columns },
    });
    ids.set(task.id, name);
  }
  return { ada, bob, ids };
}

const rollback = new Error("Rollback fixture");

async function inRolledBackTransaction(run: (tx: Tx) => Promise<void>) {
  if (!db) throw new Error("Missing integration database");
  await expect(
    db.$transaction(async (tx) => {
      await run(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

const ADA_IS_RESPONSIBLE_FOR = ["asked by ada", "made by ada", "owned by ada"];
const BOB_IS_RESPONSIBLE_FOR = [
  "asked by ada, owned by bob",
  "asked by bob",
  "owned by bob, made by ada",
];

// The filters must pick exactly the work resolveResponsibleUserId names the
// person for: the Owner first, then the person Creator, then the Requester.
describe.skipIf(!enabled)("responsible-person filters", () => {
  it("select the work the person is responsible for, in Prisma", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { ada, bob, ids } = await seedTasks(tx);
      const names = async (userId: string) =>
        (
          await tx.task.findMany({
            where: {
              id: { in: [...ids.keys()] },
              ...buildResponsibleUserWhere(userId),
            },
            select: { name: true },
          })
        )
          .map((task) => task.name)
          .sort();

      expect(await names(ada)).toEqual(ADA_IS_RESPONSIBLE_FOR);
      expect(await names(bob)).toEqual(BOB_IS_RESPONSIBLE_FOR);
    });
  });

  it("select the work the person is responsible for, by a person filter", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { ada, bob, ids } = await seedTasks(tx);
      const names = async (userId: string) =>
        (
          await tx.task.findMany({
            where: {
              id: { in: [...ids.keys()] },
              ...buildResponsibleUserMatchingWhere({
                email: { contains: userId },
              }),
            },
            select: { name: true },
          })
        )
          .map((task) => task.name)
          .sort();

      expect(await names(ada)).toEqual(ADA_IS_RESPONSIBLE_FOR);
      expect(await names(bob)).toEqual(BOB_IS_RESPONSIBLE_FOR);
    });
  });

  it("select every other piece of work, nobody's included", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { ada, ids } = await seedTasks(tx);
      const names = (
        await tx.task.findMany({
          where: {
            id: { in: [...ids.keys()] },
            ...buildNotResponsibleUserWhere(ada),
          },
          select: { name: true },
        })
      )
        .map((task) => task.name)
        .sort();

      expect(names).toEqual(
        [...BOB_IS_RESPONSIBLE_FOR, "made by a deleted person"].sort(),
      );
    });
  });

  it("select the work the person is responsible for, in SQL", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { ada, bob, ids } = await seedTasks(tx);
      const names = async (userId: string) =>
        (
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT t.id FROM "task" AS t
            WHERE ${buildResponsibleUserSql(userId)}
          `
        )
          .flatMap((task) => ids.get(task.id) ?? [])
          .sort();

      expect(await names(ada)).toEqual(ADA_IS_RESPONSIBLE_FOR);
      expect(await names(bob)).toEqual(BOB_IS_RESPONSIBLE_FOR);
    });
  });
});

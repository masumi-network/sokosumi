import { randomUUID } from "node:crypto";
import {
  type Prisma,
  TaskScheduleState,
  TaskVisibility,
} from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import { prepareTasksForUserDeletion } from "./user-deletion-tasks";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

type Tx = Prisma.TransactionClient;

async function createPerson(tx: Tx, name: string) {
  const id = randomUUID();
  await tx.user.create({
    data: {
      id,
      name,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return id;
}

async function seedWorkspaceWork(tx: Tx) {
  const ada = await createPerson(tx, "Ada");
  const bob = await createPerson(tx, "Bob");
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const personalWorkspaceId = randomUUID();
  const coworkerVendorId = randomUUID();
  const coworkerId = randomUUID();
  await tx.workspace.create({ data: { id: personalWorkspaceId, userId: ada } });
  await tx.organization.create({
    data: {
      id: organizationId,
      name: "Acme",
      slug: `acme-${organizationId}`,
      createdAt: new Date(),
      members: {
        create: [
          { userId: ada, role: "member" },
          { userId: bob, role: "owner" },
        ],
      },
      workspace: { create: { id: workspaceId } },
    },
  });
  await tx.vendor.create({
    data: {
      id: coworkerVendorId,
      name: "Vendor",
      slug: `vendor-${coworkerVendorId}`,
    },
  });
  await tx.coworker.create({
    data: {
      id: coworkerId,
      name: "Coworker",
      slug: `coworker-${coworkerId}`,
      vendorId: coworkerVendorId,
    },
  });
  const agentId = randomUUID();
  await tx.agentPricing.create({
    data: { id: agentId, pricingType: "FREE" },
  });
  await tx.agent.create({
    data: {
      id: agentId,
      blockchainIdentifier: `chain-${agentId}`,
      name: "Research Agent",
      apiBaseUrl: "https://example.test/agent",
      lastUptimeCheck: new Date(),
      pricingId: agentId,
      uptimeCount: 1,
      uptimeCheckCount: 1,
      isShown: true,
    },
  });

  const task = (name: string, data: Partial<Prisma.TaskUncheckedCreateInput>) =>
    tx.task.create({
      data: {
        name,
        workspaceId,
        organizationId,
        ownerId: ada,
        creatorUserId: ada,
        ...data,
      },
    });
  const publicTask = await task("Ada's public task", {});
  const privateTask = await task("Ada's private task", {
    visibility: TaskVisibility.PRIVATE,
  });
  const madeForAdaTask = await task("Made for Ada by a Coworker", {
    creatorUserId: null,
    creatorCoworkerId: coworkerId,
  });
  const bobsPrivateTask = await task("Bob's private task", {
    ownerId: bob,
    creatorUserId: bob,
    visibility: TaskVisibility.PRIVATE,
  });
  const personalTask = await task("Ada's personal task", {
    workspaceId: personalWorkspaceId,
    organizationId: null,
  });

  const schedule = (
    name: string,
    data: Partial<Prisma.TaskScheduleUncheckedCreateInput>,
  ) =>
    tx.taskSchedule.create({
      data: {
        name,
        workspaceId,
        organizationId,
        ownerId: ada,
        creatorUserId: ada,
        expr: "0 9 * * 1",
        timezone: "UTC",
        anchorAt: new Date(),
        ruleEffectiveFrom: new Date(),
        epochId: randomUUID(),
        ...data,
      },
    });
  const publicSchedule = await schedule("Ada's weekly review", {});
  const privateSchedule = await schedule("Ada's private review", {
    visibility: TaskVisibility.PRIVATE,
  });
  const bobsSchedule = await schedule("Bob's weekly review", {
    ownerId: bob,
    creatorUserId: bob,
  });

  const job = (name: string, data: Partial<Prisma.JobUncheckedCreateInput>) =>
    tx.job.create({
      data: {
        name,
        agentId,
        agentJobId: randomUUID(),
        jobType: "FREE",
        workspaceId,
        organizationId,
        ownerId: ada,
        creatorUserId: ada,
        ...data,
      },
    });
  const publicJob = await job("Job on the public task", {
    taskId: publicTask.id,
  });
  const privateJob = await job("Job on the private task", {
    taskId: privateTask.id,
  });
  const looseJob = await job("Job without a task", {});
  const personalJob = await job("Personal job", {
    workspaceId: personalWorkspaceId,
    organizationId: null,
  });

  return {
    ada,
    bob,
    agentId,
    coworkerId,
    workspaceId,
    organizationId,
    tasks: {
      publicTask,
      privateTask,
      madeForAdaTask,
      bobsPrivateTask,
      personalTask,
    },
    schedules: { publicSchedule, privateSchedule, bobsSchedule },
    jobs: { publicJob, privateJob, looseJob, personalJob },
  };
}

const rollback = new Error("Rollback fixture");

async function inRolledBackTransaction(run: (tx: Tx) => Promise<void>) {
  if (!db) throw new Error("Missing integration database");
  await expect(
    db.$transaction(
      async (tx) => {
        await run(tx);
        throw rollback;
      },
      { timeout: 30_000 },
    ),
  ).rejects.toBe(rollback);
}

/** Runs the deletion inside the fixture transaction so it rolls back too. */
function deleteAccount(tx: Tx, userId: string) {
  return prepareTasksForUserDeletion(userId, {
    $transaction: (callback: (client: Tx) => Promise<unknown>) => callback(tx),
  } as never);
}

// Real Postgres: foreign keys, CHECKs and the history triggers decide what
// survives an account deletion, so a mocked client cannot prove it.
describe.skipIf(!enabled)("account deletion keeps public work", () => {
  it("deletes the person's private work and keeps their public work without an Owner", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { ada, bob, coworkerId, tasks, jobs } = await seedWorkspaceWork(tx);

      await deleteAccount(tx, ada);

      const keptTasks = await tx.task.findMany({
        where: { id: { in: Object.values(tasks).map((task) => task.id) } },
        select: {
          id: true,
          ownerId: true,
          creatorUserId: true,
          creatorCoworkerId: true,
        },
        orderBy: { name: "asc" },
      });
      expect(keptTasks).toEqual([
        {
          id: tasks.publicTask.id,
          ownerId: null,
          creatorUserId: null,
          creatorCoworkerId: null,
        },
        {
          id: tasks.bobsPrivateTask.id,
          ownerId: bob,
          creatorUserId: bob,
          creatorCoworkerId: null,
        },
        {
          id: tasks.madeForAdaTask.id,
          ownerId: null,
          creatorUserId: null,
          creatorCoworkerId: coworkerId,
        },
      ]);

      const keptJobs = await tx.job.findMany({
        where: { id: { in: Object.values(jobs).map((job) => job.id) } },
        select: { id: true, ownerId: true, creatorUserId: true },
        orderBy: { name: "asc" },
      });
      expect(keptJobs).toEqual([
        { id: jobs.publicJob.id, ownerId: null, creatorUserId: null },
        { id: jobs.looseJob.id, ownerId: null, creatorUserId: null },
      ]);
    });
  });

  it("keeps the public work in the workspace history without a member", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { ada, tasks, jobs } = await seedWorkspaceWork(tx);

      await deleteAccount(tx, ada);

      const history = await tx.history.findMany({
        where: {
          entityId: {
            in: [
              tasks.publicTask.id,
              tasks.privateTask.id,
              jobs.publicJob.id,
              jobs.privateJob.id,
            ],
          },
        },
        select: { entityId: true, userId: true },
      });
      expect(history).toEqual(
        expect.arrayContaining([
          { entityId: tasks.publicTask.id, userId: null },
          { entityId: jobs.publicJob.id, userId: null },
        ]),
      );
      expect(history).toHaveLength(2);
    });
  });

  it("pauses the public Task Schedules the person owned and deletes their private ones", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { ada, schedules } = await seedWorkspaceWork(tx);

      await deleteAccount(tx, ada);

      const kept = await tx.taskSchedule.findMany({
        where: {
          id: { in: Object.values(schedules).map((schedule) => schedule.id) },
        },
        select: { id: true, state: true, ownerId: true },
        orderBy: { name: "asc" },
      });
      expect(kept).toEqual([
        {
          id: schedules.publicSchedule.id,
          state: TaskScheduleState.PAUSED,
          ownerId: null,
        },
        {
          id: schedules.bobsSchedule.id,
          state: TaskScheduleState.ACTIVE,
          ownerId: expect.any(String),
        },
      ]);
    });
  });
});

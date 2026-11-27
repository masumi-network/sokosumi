import { randomUUID } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Network } from "@/lib/network";
import { onSplitLayout } from "@/test/split-layout";
import {
  insertRow,
  seedAgent,
  seedJob,
} from "@/test-fixtures/user-deletion-world";

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

vi.mock("@sentry/node", () => ({ captureMessage: vi.fn() }));

type Tx = Prisma.TransactionClient;
const AT = "2026-01-01T00:00:00";

// Committed rows and two connections: a lock is only held against another
// session. Every test removes what it wrote, also when it fails.
describe.runIf(ON_POSTGRES)(
  "the account deletion beside a writer on another connection",
  () => {
    let prisma: typeof import("@/lib/db/prisma").default;
    let prepareTasksForUserDeletion: typeof import("./user-deletion-tasks").prepareTasksForUserDeletion;
    let evaluateUserDeletion: typeof import("./deletion-evaluate").evaluateUserDeletion;
    let createNetworkScope: typeof import("@/lib/db/network-scope").createNetworkScope;
    let countOrphans: typeof import("@/lib/db/crossing-key-orphans").countCrossingKeyOrphans;
    const networks: Network[] = onSplitLayout
      ? ["mainnet", "preprod"]
      : ["mainnet"];
    const cleanup: (() => Promise<unknown>)[] = [];

    beforeAll(async () => {
      vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
      ({ default: prisma } = await import("@/lib/db/prisma"));
      ({ prepareTasksForUserDeletion } = await import("./user-deletion-tasks"));
      ({ evaluateUserDeletion } = await import("./deletion-evaluate"));
      ({ createNetworkScope } = await import("@/lib/db/network-scope"));
      ({ countCrossingKeyOrphans: countOrphans } = await import(
        "@/lib/db/crossing-key-orphans"
      ));
    }, 60_000);

    afterEach(async () => {
      for (const remove of cleanup.splice(0).reverse()) await remove();
    }, 60_000);

    afterAll(() => vi.unstubAllEnvs());

    /** A user with a personal workspace, and one Agent on every Network. */
    async function account() {
      const userId = randomUUID();
      const workspaceId = randomUUID();
      const agentId = randomUUID();
      cleanup.push(() => prisma.user.deleteMany({ where: { id: userId } }));
      await prisma.user.create({
        data: {
          id: userId,
          name: "Ada",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: workspaceId } },
        },
      });
      for (const network of networks) {
        cleanup.push(async () => {
          await prisma.$executeRaw`DELETE FROM ${netTable(network, "Job")} WHERE "agentId" = ${agentId}`;
          await prisma.$executeRaw`DELETE FROM ${netTable(network, "Agent")} WHERE "id" = ${agentId}`;
          await prisma.$executeRaw`DELETE FROM ${netTable(network, "AgentPricing")} WHERE "id" = ${agentId}`;
        });
        await seedAgent(prisma, network, agentId);
      }
      const job = (network: Network, tx: Tx | typeof prisma, id: string) =>
        seedJob(tx, network, { id, agentId, workspaceId, ownerId: userId });
      return { userId, workspaceId, agentId, job };
    }

    /** Resolves once a session of this database waits for a lock. */
    async function untilASessionWaits(): Promise<void> {
      for (;;) {
        const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `;
        if (waiting > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }

    /**
     * The writer wins: it holds its row uncommitted, the deletion starts and
     * waits for it, and then finds what the writer committed.
     */
    async function writerFirst(
      userId: string,
      write: (tx: Tx) => Promise<void>,
    ): Promise<void> {
      const written = Promise.withResolvers<void>();
      const commit = Promise.withResolvers<void>();
      const writing = prisma.$transaction(
        async (tx) => {
          await write(tx);
          written.resolve();
          await commit.promise;
        },
        { timeout: 30_000 },
      );
      await Promise.race([written.promise, writing]);
      const deleting = prepareTasksForUserDeletion(userId, prisma);
      await untilASessionWaits();
      commit.resolve();
      await writing;
      await deleting;
    }

    /**
     * The deletion wins: it has removed the Jobs and holds its locks when the
     * writer starts, and commits while the writer waits. Returns what the
     * writer got.
     */
    async function deletionFirst(
      userId: string,
      write: (tx: Tx) => Promise<void>,
    ): Promise<string> {
      let writing: Promise<string> | undefined;
      await prepareTasksForUserDeletion(userId, {
        $transaction: (
          callback: (client: Tx) => Promise<unknown>,
          options: object,
        ) =>
          prisma.$transaction(async (tx) => {
            // The chat rooms are read after the Jobs went and before the
            // User does.
            const chatRoom = {
              findMany: async (
                ...args: Parameters<Tx["chatRoom"]["findMany"]>
              ) => {
                writing = prisma.$transaction(write).then(
                  () => "written",
                  (error: { code?: string; message?: string }) =>
                    `${error.code} ${error.message}`,
                );
                await untilASessionWaits();
                return tx.chatRoom.findMany(...args);
              },
            };
            return callback(
              new Proxy(tx, {
                get: (target, property, receiver) =>
                  property === "chatRoom"
                    ? chatRoom
                    : Reflect.get(target, property, receiver),
              }),
            );
          }, options),
      } as never);
      if (!writing) throw new Error("The writer never started");
      return writing;
    }

    async function expectNothingLeft(userId: string, agentId: string) {
      expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
      for (const network of networks) {
        expect(
          await prisma.$queryRaw`SELECT "id" FROM ${netTable(network, "Job")} WHERE "agentId" = ${agentId}`,
        ).toEqual([]);
      }
      const orphans = await countOrphans(prisma);
      expect(orphans.filter(({ count }) => count > 0n)).toEqual([]);
    }

    describe.each(networks)("a Job created on %s", (network) => {
      it("is deleted with the account when its creator committed first", async () => {
        const { userId, agentId, job } = await account();

        await writerFirst(userId, (tx) => job(network, tx, randomUUID()));

        await expectNothingLeft(userId, agentId);
      }, 60_000);

      it("is refused by its key when the deletion committed first", async () => {
        const { userId, agentId, job } = await account();

        const writer = await deletionFirst(userId, (tx) =>
          job(network, tx, randomUUID()),
        );

        expect(writer).toContain("foreign key constraint");
        await expectNothingLeft(userId, agentId);
      }, 60_000);
    });

    // The move of `PUT /v1/jobs/{id}/workspace`: it takes no lock the
    // deletion holds, because the Job's Owner stays and only the destination
    // workspace is new to it.
    describe.each(networks)(
      "a Job moved out of the personal workspace on %s",
      (network) => {
        async function accountWithAJobToMove() {
          const created = await account();
          const jobId = randomUUID();
          const organizationId = randomUUID();
          const destinationId = randomUUID();
          cleanup.push(async () => {
            await prisma.$executeRaw`DELETE FROM ${netTable(network, "Job")} WHERE "id" = ${jobId}`;
            await prisma.organization.deleteMany({
              where: { id: organizationId },
            });
          });
          await prisma.organization.create({
            data: {
              id: organizationId,
              name: "Destination",
              slug: `destination-${organizationId}`,
              members: { create: { userId: created.userId, role: "member" } },
              workspace: { create: { id: destinationId } },
            },
          });
          await created.job(network, prisma, jobId);
          let moved: number | undefined;
          const move = async (tx: Tx) => {
            moved = await tx.$executeRaw`
            UPDATE ${netTable(network, "Job")}
            SET "workspaceId" = ${destinationId}::uuid, "projectId" = NULL
            WHERE "id" = ${jobId}`;
          };
          const job = () =>
            prisma.$queryRaw<{ workspaceId: string; ownerId: string | null }[]>`
            SELECT "workspaceId", "ownerId" FROM ${netTable(network, "Job")} WHERE "id" = ${jobId}`;
          return { ...created, destinationId, move, job, moved: () => moved };
        }

        it("stays in its destination, without its Owner, when the move committed first", async () => {
          const { userId, destinationId, move, job, moved } =
            await accountWithAJobToMove();

          await writerFirst(userId, move);

          expect(moved()).toBe(1);
          expect(await job()).toEqual([
            { workspaceId: destinationId, ownerId: null },
          ]);
          expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
        }, 60_000);

        it("is deleted with the account, and the move finds no Job, when the deletion locked it first", async () => {
          const { userId, move, job, moved } = await accountWithAJobToMove();

          expect(await deletionFirst(userId, move)).toBe("written");

          expect(moved()).toBe(0);
          expect(await job()).toEqual([]);
          expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
        }, 60_000);
      },
    );

    describe("a share of a Job that goes with the account", () => {
      async function accountWithAJob() {
        const created = await account();
        const jobId = randomUUID();
        await created.job("mainnet", prisma, jobId);
        const shareId = randomUUID();
        cleanup.push(
          () =>
            prisma.$executeRaw`DELETE FROM ${sharedTable("jobShare")} WHERE "id" = ${shareId}`,
        );
        const share = (tx: Tx) =>
          insertRow(tx, sharedTable("jobShare"), {
            id: shareId,
            updatedAt: AT,
            token: shareId,
            jobId,
          });
        const shares = () =>
          prisma.$queryRaw`SELECT "id" FROM ${sharedTable("jobShare")} WHERE "id" = ${shareId}`;
        return { ...created, share, shares };
      }

      it("is deleted with the Job when the share committed first", async () => {
        const { userId, agentId, share, shares } = await accountWithAJob();

        await writerFirst(userId, share);

        expect(await shares()).toEqual([]);
        await expectNothingLeft(userId, agentId);
      }, 60_000);

      it("is refused by its key when the deletion committed first", async () => {
        const { userId, agentId, share, shares } = await accountWithAJob();

        const writer = await deletionFirst(userId, share);

        expect(writer).toContain("foreign key constraint");
        expect(await shares()).toEqual([]);
        await expectNothingLeft(userId, agentId);
      }, 60_000);
    });

    describe.each(networks)("the preflight, for rows on %s", (network) => {
      const blockers = async (userId: string) =>
        (
          await evaluateUserDeletion(
            userId,
            prisma,
            networks.map(createNetworkScope),
          )
        ).blockers;

      it("reports a Job that has not finished", async () => {
        const { userId, job } = await account();
        expect(await blockers(userId)).toEqual([]);

        await job(network, prisma, randomUUID());

        expect(await blockers(userId)).toEqual(["IN_FLIGHT_JOB"]);
      }, 60_000);

      it("reports a pending payment on a Task the user owns", async () => {
        const { userId, workspaceId, agentId } = await account();
        const task = await prisma.task.create({
          data: { name: "Paid task", workspaceId, ownerId: userId },
        });
        const transactionId = randomUUID();
        cleanup.push(async () => {
          await prisma.$executeRaw`DELETE FROM ${netTable(network, "task_x402_payment")} WHERE "transactionId" = ${transactionId}`;
          await prisma.$executeRaw`DELETE FROM ${netTable(network, "Transaction")} WHERE "id" = ${transactionId}`;
          await prisma.task.deleteMany({ where: { id: task.id } });
        });
        // Charged to nobody: only the Task leads to this user.
        await insertRow(prisma, netTable(network, "Transaction"), {
          id: transactionId,
          updatedAt: AT,
          amount: 1,
        });
        await insertRow(prisma, netTable(network, "task_x402_payment"), {
          id: randomUUID(),
          updatedAt: AT,
          idempotencyKey: transactionId,
          caip2Network: "test",
          asset: "test",
          amount: "1",
          payTo: "test",
          agentId,
          status: "PENDING",
          taskId: task.id,
          transactionId,
        });

        expect(await blockers(userId)).toContain("TASK_X402_PAYMENT_PENDING");
      }, 60_000);
    });
  },
);

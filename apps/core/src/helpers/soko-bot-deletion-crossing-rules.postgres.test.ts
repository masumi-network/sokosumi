import type { Prisma } from "@sokosumi/database";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Network } from "@/lib/network";
import { onSplitLayout } from "@/test/split-layout";
import {
  digests,
  dropFlowCrossingKeys,
  keysFor,
  refusal,
} from "@/test-fixtures/crossing-key-comparison";
import {
  addSokoBotDeletionNetworkRows,
  newSokoBotDeletionWorld,
  type SokoBotDeletionCase,
  type SokoBotDeletionWorld,
  seedSokoBotDeletionWorld,
} from "@/test-fixtures/soko-bot-deletion-world";
import {
  insertRow,
  recordedRules,
  seedJob,
} from "@/test-fixtures/user-deletion-world";

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

type Tx = Prisma.TransactionClient;

const core = vi.hoisted(() => ({
  appliesTheRules: true,
  /** The counts read nothing, as a count taken before a write would. */
  staleCounts: false,
  counts: {} as Record<string, number>,
  tx: undefined as Tx | undefined,
}));

/** `origin/main` counts through the shared client, which reads Mainnet. */
async function baseCounts(tx: Tx, sokoBotId: string) {
  if (!onSplitLayout) {
    return {
      billingRecords: await tx.sokoBotUsage.count({ where: { sokoBotId } }),
      jobs: await tx.job.count({ where: { creatorSokoBotId: sokoBotId } }),
    };
  }
  // On the split layout the shared client has no Network table; Mainnet's is
  // what it read before the split.
  const [counts] = await tx.$queryRaw<
    { billingRecords: number; jobs: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM ${netTable("mainnet", "soko_bot_usage")} WHERE "sokoBotId" = ${sokoBotId}::uuid) AS "billingRecords",
      (SELECT count(*)::int FROM ${netTable("mainnet", "Job")} WHERE "creatorSokoBotId" = ${sokoBotId}::uuid) AS jobs
  `;
  return counts;
}

vi.mock("./user-deletion-crossing-rules", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./user-deletion-crossing-rules")>();
  return {
    ...actual,
    ...recordedRules(
      { applyRulesAfterDelete: actual.applyRulesAfterDelete },
      core,
    ),
  };
});
vi.mock("./soko-bot-deletion-crossing-rules", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./soko-bot-deletion-crossing-rules")>();
  return {
    ...actual,
    countSokoBotNetworkRows: (tx: Tx, sokoBotId: string) =>
      core.staleCounts
        ? { billingRecords: 0, jobs: 0 }
        : core.appliesTheRules
          ? actual.countSokoBotNetworkRows(tx, sokoBotId)
          : baseCounts(tx, sokoBotId),
  };
});
vi.mock("@/lib/db/prisma", async (importOriginal) => {
  const db = await importOriginal<typeof import("@/lib/db/prisma")>();
  return {
    ...db,
    default: new Proxy(db.default, {
      get(target, property, receiver) {
        if (!core.tx) throw new Error("Expected the test transaction");
        return Reflect.get(core.tx, property, receiver);
      },
    }),
  };
});
vi.mock("@/lib/db/transaction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/transaction")>()),
  serializableTransaction: (run: (tx: Tx) => Promise<unknown>) => {
    if (!core.tx) throw new Error("Expected the test transaction");
    return run(core.tx);
  },
}));
vi.mock("@/services/polar-subscription-end.service", () => ({
  revokeCusoSubscription: vi.fn(async () => undefined),
  revokeSubscriptionsLeftByEnding: vi.fn(async () => undefined),
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  revokeSokoBotIntegrationAccounts: vi.fn(async () => ({ failed: [] })),
}));
vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: vi.fn(async () => undefined),
}));
vi.mock("@/helpers/chat-room-mention-status", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/helpers/chat-room-mention-status")
  >()),
  publishChatRoomMentionStatuses: vi.fn(async () => undefined),
}));

const networks: Network[] = onSplitLayout
  ? ["mainnet", "preprod"]
  : ["mainnet"];
const preprodStates = onSplitLayout
  ? (["paused", "open"] as const)
  : (["off"] as const);
type Flow = "Soko Bot" | "failed CMO hire";

describe.runIf(ON_POSTGRES)(
  "Soko Bot and Project deletion and crossing keys",
  () => {
    let db: typeof import("@/lib/db/prisma").default;
    let deleteSokoBot: typeof import("@/services/soko-bot-deletion.service").deleteSokoBot;
    let deleteProject: typeof import("./soko-bot-deletion-crossing-rules").deleteProjectWithNetworkRows;
    let countOrphans: typeof import("@/lib/db/crossing-key-orphans").countCrossingKeyOrphans;
    let pauseKey: string;

    beforeAll(async () => {
      vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
      ({ default: db } =
        await vi.importActual<typeof import("@/lib/db/prisma")>(
          "@/lib/db/prisma",
        ));
      ({ deleteSokoBot } = await import(
        "@/services/soko-bot-deletion.service"
      ));
      ({ deleteProjectWithNetworkRows: deleteProject } = await import(
        "./soko-bot-deletion-crossing-rules"
      ));
      ({ countCrossingKeyOrphans: countOrphans } = await import(
        "@/lib/db/crossing-key-orphans"
      ));
      ({ PREPROD_PAUSE_KEY: pauseKey } = await import(
        "@/helpers/preprod-control"
      ));
      // A tombstone is stamped with the time; each run must stamp the same.
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-02-01") });
    }, 60_000);

    afterAll(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    // Needs its own PostgreSQL database: it drops keys and compares every
    // table, isolated by CI's POSTGRES_TEST_DATABASE_PER_WORKER option.
    async function inWorld(
      pointing: SokoBotDeletionCase,
      preprod: "off" | "paused" | "open",
      run: (tx: Tx, world: SokoBotDeletionWorld) => Promise<void>,
      seed = (tx: Tx, world: SokoBotDeletionWorld) =>
        seedSokoBotDeletionWorld(tx, networks, world, pointing),
    ) {
      const rollback = new Error("roll back test world");
      try {
        await db.$transaction(
          async (tx) => {
            const world = newSokoBotDeletionWorld();
            await seed(tx, world);
            if (preprod === "open") {
              await insertRow(tx, sharedTable("sync_metadata"), {
                id: world.id("preprodState"),
                key: pauseKey,
                cursorId: "open",
                lastSyncedAt: "2026-01-01T00:00:00",
                updatedAt: "2026-01-01T00:00:00",
              });
            }
            await tx.$executeRaw`SAVEPOINT before_deletion`;
            core.tx = tx;
            await run(tx, world);
            throw rollback;
          },
          { timeout: 120_000 },
        );
      } catch (error) {
        if (error !== rollback) throw error;
      } finally {
        core.tx = undefined;
        core.staleCounts = false;
      }
    }

    async function remove(
      tx: Tx,
      world: SokoBotDeletionWorld,
      flow: Flow,
      rules: boolean,
    ) {
      core.appliesTheRules = rules;
      core.counts = {};
      if (flow === "Soko Bot") {
        return (await deleteSokoBot(world.sokoBotId)).outcome;
      }
      // `origin/main`'s clean-up: one Project delete, which the keys follow.
      if (rules) await deleteProject(tx, world.projectId);
      else await tx.project.delete({ where: { id: world.projectId } });
      return "deleted";
    }

    async function rollBack(tx: Tx) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT before_deletion`;
    }

    async function orphans(tx: Tx) {
      return (await countOrphans(tx)).filter(({ count }) => count > 0n);
    }

    /** Rows named by id that every outcome keeps as they were. */
    async function expectSurvivors(
      tx: Tx,
      { id }: SokoBotDeletionWorld,
      flow: Flow,
    ) {
      expect(
        await tx.sokoBot.findUnique({
          where: { id: id("bot.other") },
          select: { projectId: true },
        }),
      ).toEqual({ projectId: id("otherProject") });
      for (const network of networks) {
        const [rows] = await tx.$queryRaw<
          {
            bucket: boolean;
            usage: boolean;
            job: boolean;
            projectBucket: boolean;
            projectUsage: boolean;
            projectJob: string | null;
          }[]
        >`
          SELECT
            EXISTS (SELECT 1 FROM ${netTable(network, "credit_bucket")}
              WHERE id = ${id("bucket.other")} AND "projectId" = ${id("otherProject")}::uuid) AS bucket,
            EXISTS (SELECT 1 FROM ${netTable(network, "soko_bot_usage")}
              WHERE id = ${id("usage.other")} AND "sokoBotId" = ${id("bot.other")}::uuid) AS usage,
            EXISTS (SELECT 1 FROM ${netTable(network, "Job")}
              WHERE id = ${id("job.other")} AND "projectId" = ${id("otherProject")}::uuid
                AND "creatorSokoBotId" = ${id("bot.other")}::uuid) AS job,
            EXISTS (SELECT 1 FROM ${netTable(network, "credit_bucket")}
              WHERE id = ${id("bucket.project")}) AS "projectBucket",
            EXISTS (SELECT 1 FROM ${netTable(network, "soko_bot_usage")}
              WHERE id = ${id("usage.project")}) AS "projectUsage",
            (SELECT "projectId"::text FROM ${netTable(network, "Job")}
              WHERE id = ${id("job.project")}) AS "projectJob"
        `;
        const hire = flow === "failed CMO hire";
        expect(rows).toEqual({
          bucket: true,
          usage: true,
          job: true,
          projectBucket: !hire,
          projectUsage: !hire,
          projectJob: hire ? null : id("project"),
        });
      }
    }

    function expectedOutcome(flow: Flow, pointing: SokoBotDeletionCase) {
      return flow === "Soko Bot" && pointing !== "nothing"
        ? "tombstoned"
        : "deleted";
    }

    const cases: [Flow, SokoBotDeletionCase][] = [
      ["Soko Bot", "nothing"],
      ["Soko Bot", "usage"],
      ["Soko Bot", "job"],
      ["failed CMO hire", "nothing"],
    ];
    describe.each(cases)("%s with %s pointing at the bot", (flow, pointing) => {
      it.each(preprodStates)(
        "matches the legacy end state with keys and without keys when Preprod is %s",
        async (preprod) => {
          await inWorld(pointing, preprod, async (tx, world) => {
            const seeded = await digests(tx);
            expect(await remove(tx, world, flow, false)).toBe(
              expectedOutcome(flow, pointing),
            );
            const base = await digests(tx);
            expect(base).not.toEqual(seeded);
            await expectSurvivors(tx, world, flow);
            await rollBack(tx);

            expect(await remove(tx, world, flow, true)).toBe(
              expectedOutcome(flow, pointing),
            );
            const withKeys = { ...core.counts };
            expect(Object.values(withKeys).filter(Boolean)).toEqual([]);
            expect(await digests(tx)).toEqual(base);
            expect(await orphans(tx)).toEqual([]);
            await rollBack(tx);

            await dropFlowCrossingKeys(tx, flow, networks);
            expect(await remove(tx, world, flow, true)).toBe(
              expectedOutcome(flow, pointing),
            );
            const cascades = keysFor(flow)
              .filter(([, , , action]) => action !== "Restrict")
              .map(([table, column]) => `${table}.${column}`)
              .sort();
            if (flow === "failed CMO hire") {
              // Every cascade and clear had a row to act on.
              expect(Object.keys(core.counts).sort()).toEqual(cascades);
              expect(
                Object.entries(core.counts).filter(([, rows]) => rows === 0),
              ).toEqual([]);
            } else {
              // A bot with a usage row is never hard-deleted, so the sweep
              // finds none unless the count was stale (tested below).
              expect(core.counts).toEqual(
                pointing === "nothing" ? { "soko_bot_usage.sokoBotId": 0 } : {},
              );
            }
            expect(Object.keys(withKeys).sort()).toEqual(
              Object.keys(core.counts).sort(),
            );
            await expectSurvivors(tx, world, flow);
            expect(await digests(tx)).toEqual(base);
            expect(await orphans(tx)).toEqual([]);
          });
        },
        120_000,
      );
    });

    it("sweeps the bot's usage after its delete when the count was stale and the keys are dropped", async () => {
      await inWorld("usage", preprodStates[0], async (tx, world) => {
        await dropFlowCrossingKeys(tx, "Soko Bot", networks);
        core.staleCounts = true;
        expect(await remove(tx, world, "Soko Bot", true)).toBe("deleted");
        expect(core.counts).toEqual({
          "soko_bot_usage.sokoBotId": networks.length,
        });
        for (const network of networks) {
          expect(
            await tx.$queryRaw`
              SELECT id FROM ${netTable(network, "soko_bot_usage")}
              WHERE "sokoBotId" = ${world.sokoBotId}::uuid
            `,
          ).toEqual([]);
        }
        await expectSurvivors(tx, world, "Soko Bot");
        expect(await orphans(tx)).toEqual([]);
      });
    }, 120_000);

    describe.runIf(onSplitLayout)("a row on Preprod only", () => {
      it.each(["usage", "job"] as const)(
        "a %s on Preprod keeps the tombstone",
        async (pointing) => {
          await inWorld(
            "nothing",
            "paused",
            async (tx, world) => {
              expect(await remove(tx, world, "Soko Bot", true)).toBe(
                "tombstoned",
              );
            },
            // Mainnet holds nothing pointing at the bot; Preprod holds one row.
            async (tx, world) => {
              await seedSokoBotDeletionWorld(tx, ["mainnet"], world, "nothing");
              await addSokoBotDeletionNetworkRows(
                tx,
                "preprod",
                world,
                pointing,
              );
            },
          );
        },
        120_000,
      );
    });

    for (const network of networks) {
      it(`refuses the Project of a bot that hired a Job on ${network}`, async () => {
        await inWorld("nothing", preprodStates[0], async (tx, world) => {
          const seed = () =>
            seedJob(tx, network, {
              id: world.id("job.hired"),
              agentId: world.id("agent"),
              workspaceId: world.id("workspace"),
              creatorSokoBotId: world.id("bot.project"),
            });
          await seed();
          expect(
            await remove(tx, world, "failed CMO hire", false).then(
              () => "deleted",
              refusal,
            ),
          ).toBe("foreign key");
          await rollBack(tx);
          for (const keys of ["present", "dropped"]) {
            if (keys === "dropped")
              await dropFlowCrossingKeys(tx, "failed CMO hire", networks);
            await seed();
            expect(
              await remove(tx, world, "failed CMO hire", true).then(
                () => "deleted",
                refusal,
              ),
            ).toBe("PROJECT_DELETION_SOKO_BOT_HIRED_JOB");
            expect(
              await tx.project.findUnique({
                where: { id: world.projectId },
                select: { id: true },
              }),
            ).toEqual({ id: world.projectId });
            await rollBack(tx);
          }
        });
      }, 120_000);
    }
  },
);

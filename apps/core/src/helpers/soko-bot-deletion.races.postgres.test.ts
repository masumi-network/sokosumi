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
  newSokoBotDeletionWorld,
  type SokoBotDeletionWorld,
  seedSokoBotDeletionWorld,
} from "@/test-fixtures/soko-bot-deletion-world";
import {
  insertRow,
  recordedRules,
  seedJob,
} from "@/test-fixtures/user-deletion-world";

type Tx = Prisma.TransactionClient;
type Client = typeof import("@/lib/db/prisma").default;
type Wrap = (tx: Tx) => Tx | Promise<Tx>;
type Mode = "base" | "head";

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

const core = vi.hoisted(() => ({
  appliesTheRules: true,
  counts: {} as Record<string, number>,
  wrap: ((tx: Tx) => tx) as Wrap,
}));

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
    // `origin/main` counted through the shared client: Mainnet's rows.
    countSokoBotNetworkRows: async (tx: Tx, sokoBotId: string) => {
      if (core.appliesTheRules)
        return actual.countSokoBotNetworkRows(tx, sokoBotId);
      const [counts] = await tx.$queryRaw<
        { billingRecords: number; jobs: number }[]
      >`
        SELECT
          (SELECT count(*)::int FROM ${netTable("mainnet", "soko_bot_usage")} WHERE "sokoBotId" = ${sokoBotId}::uuid) AS "billingRecords",
          (SELECT count(*)::int FROM ${netTable("mainnet", "Job")} WHERE "creatorSokoBotId" = ${sokoBotId}::uuid) AS jobs
      `;
      return counts;
    },
  };
});
vi.mock("@/lib/db/transaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/transaction")>();
  return {
    ...actual,
    serializableTransaction: (
      run: (tx: Tx) => Promise<unknown>,
      message: string,
    ) =>
      actual.serializableTransaction(
        async (tx) => run(await core.wrap(tx)),
        message,
      ),
  };
});
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
const network = "mainnet";
const modes = ["base", "head"] as const;

/** Runs `run` once, before or after the first `model.method` call on `tx`. */
function around(
  model: "sokoBot" | "project",
  method: "delete" | "update",
  phase: "before" | "after",
  run: () => Promise<void>,
): Wrap {
  let ran = false;
  const once = async () => {
    if (ran) return;
    ran = true;
    await run();
  };
  return (tx) =>
    new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== model) return Reflect.get(target, property, receiver);
        return new Proxy(target[model], {
          get(delegate, name, inner) {
            const call = Reflect.get(delegate, name, inner);
            if (name !== method) return call;
            return async (...args: unknown[]) => {
              if (phase === "before") await once();
              const result = await Reflect.apply(call, delegate, args);
              if (phase === "after") await once();
              return result;
            };
          },
        });
      },
    });
}

function outcome(error: {
  code?: string;
  status?: number;
  meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
}) {
  const pg = error.meta?.driverAdapterError?.cause?.originalCode;
  if (error.code === "P2003" || pg === "23503" || pg === "23001")
    return "foreign key";
  return error.code ?? error.status ?? String(error);
}

describe.runIf(ON_POSTGRES)("Soko Bot and Project deletion races", () => {
  let db: Client;
  let deleteSokoBot: typeof import("@/services/soko-bot-deletion.service").deleteSokoBot;
  let deleteProject: typeof import("./soko-bot-deletion-crossing-rules").deleteProjectWithNetworkRows;
  let deleteProjectInTransaction: typeof import("./soko-bot-deletion-crossing-rules").deleteProjectInTransaction;
  const cleanup: SokoBotDeletionWorld[] = [];

  beforeAll(async () => {
    vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
    ({ default: db } = await import("@/lib/db/prisma"));
    ({ deleteSokoBot } = await import("@/services/soko-bot-deletion.service"));
    ({
      deleteProjectWithNetworkRows: deleteProject,
      deleteProjectInTransaction,
    } = await import("./soko-bot-deletion-crossing-rules"));
  }, 60_000);

  afterEach(async () => {
    for (const { id } of cleanup.splice(0)) {
      for (const local of networks) {
        await db.$executeRaw`DELETE FROM ${netTable(local, "Job")} WHERE "agentId" = ${id("agent")}`;
        await db.$executeRaw`DELETE FROM ${netTable(local, "soko_bot_usage")} WHERE "userId" = ${id("ada")}`;
        await db.$executeRaw`DELETE FROM ${netTable(local, "credit_bucket")} WHERE "userId" = ${id("ada")}`;
        await db.$executeRaw`DELETE FROM ${netTable(local, "Transaction")} WHERE "userId" = ${id("ada")}`;
        await db.$executeRaw`DELETE FROM ${netTable(local, "Agent")} WHERE id = ${id("agent")}`;
        await db.$executeRaw`DELETE FROM ${netTable(local, "AgentPricing")} WHERE id = ${id("agent")}`;
      }
      await db.sokoBot.deleteMany({ where: { workspaceId: id("workspace") } });
      await db.user.deleteMany({ where: { id: id("ada") } });
    }
    // With the keys in place, none of Core's statements changes a row.
    expect(
      Object.entries(core.counts).filter(([, rows]) => rows !== 0),
    ).toEqual([]);
    core.counts = {};
    core.wrap = (tx) => tx;
  }, 60_000);

  afterAll(() => vi.unstubAllEnvs());

  async function world() {
    const created = newSokoBotDeletionWorld();
    await db.$transaction(
      async (tx) => {
        await seedSokoBotDeletionWorld(tx, networks, created, "nothing");
        await insertRow(tx, sharedTable("soko_bot_turn"), {
          id: created.id("turn"),
          sokoBotId: created.sokoBotId,
          workspaceId: created.id("workspace"),
          source: "CHAT",
          status: "RUNNING",
          userMessage: "Test turn",
          clientTurnId: created.id("turn"),
          capabilityNames: [],
          deadlineAt: "2030-01-01T00:00:00",
          updatedAt: "2026-01-01T00:00:00",
        });
      },
      { timeout: 30_000 },
    );
    cleanup.push(created);
    return created;
  }

  function removeBot(mode: Mode, target: string, wrap: Wrap = (tx) => tx) {
    core.appliesTheRules = mode === "head";
    core.wrap = wrap;
    return deleteSokoBot(target).then(({ outcome }) => outcome, outcome);
  }

  /** The failed hire's clean-up, as `origin/main` and as head run it. */
  function removeProject(mode: Mode, projectId: string, wrap: Wrap) {
    core.appliesTheRules = mode === "head";
    const run =
      mode === "head"
        ? db.$transaction(async (tx) => {
            await deleteProject(await wrap(tx), projectId);
          })
        : (async () => {
            const client = (await wrap(db as unknown as Tx)) as Tx;
            await client.project.delete({ where: { id: projectId } });
          })();
    return run.then(() => "deleted", outcome);
  }

  async function pidOf(tx: Tx) {
    const [{ pid }] = await tx.$queryRaw<
      { pid: number }[]
    >`SELECT pg_backend_pid() AS pid`;
    return pid;
  }

  async function waitForLock(pid: number) {
    for (let attempts = 0; attempts < 300; attempts++) {
      const [{ waiting }] = await db.$queryRaw<{ waiting: boolean }[]>`
        SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS waiting
      `;
      if (waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Expected a wait on the other PostgreSQL connection");
  }

  /** A connection of this database waits on a lock (when no pid is known). */
  async function waitForAnyLock() {
    for (let attempts = 0; attempts < 300; attempts++) {
      const [{ waiting }] = await db.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database()
            AND cardinality(pg_blocking_pids(pid)) > 0
        ) AS waiting
      `;
      if (waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Expected a wait on another PostgreSQL connection");
  }

  /** `requireMutationAuthority`: the Turn, then its Soko Bot, `FOR UPDATE`. */
  async function lockRuntime(tx: Tx, { id, sokoBotId }: SokoBotDeletionWorld) {
    const turns = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM ${sharedTable("soko_bot_turn")} WHERE id = ${id("turn")}::uuid FOR UPDATE
    `;
    const bots = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM ${sharedTable("soko_bot")} WHERE id = ${sokoBotId}::uuid FOR UPDATE
    `;
    return turns.length === 1 && bots.length === 1;
  }

  const writes = {
    "usage row": async (tx: Tx, { id, sokoBotId }: SokoBotDeletionWorld) => {
      await insertRow(tx, netTable(network, "Transaction"), {
        id: id("race.charge"),
        userId: id("ada"),
        amount: -1,
        updatedAt: "2026-01-01T00:00:00",
      });
      await insertRow(tx, netTable(network, "soko_bot_usage"), {
        id: id("race.row"),
        userId: id("ada"),
        sokoBotId,
        transactionId: id("race.charge"),
        idempotencyKey: id("race.row"),
        cents: 1,
        updatedAt: "2026-01-01T00:00:00",
      });
    },
    "hired Job": (tx: Tx, { id, sokoBotId }: SokoBotDeletionWorld) =>
      seedJob(tx, network, {
        id: id("race.row"),
        agentId: id("agent"),
        workspaceId: id("workspace"),
        creatorSokoBotId: sokoBotId,
      }),
  };
  type Write = keyof typeof writes;

  async function raceRow(write: Write, { id }: SokoBotDeletionWorld) {
    const table = write === "usage row" ? "soko_bot_usage" : "Job";
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM ${netTable(network, table)} WHERE id = ${id("race.row")}
    `;
    return rows.length === 1;
  }

  async function botState({ sokoBotId }: SokoBotDeletionWorld) {
    const bot = await db.sokoBot.findUnique({
      where: { id: sokoBotId },
      select: { deletedAt: true },
    });
    return bot ? (bot.deletedAt ? "tombstoned" : "live") : "deleted";
  }

  describe.each(Object.keys(writes) as Write[])(
    "a running turn's %s",
    (write) => {
      it.each(modes)(
        "keeps the row, and base's outcome, when the runtime holds the bot first (%s)",
        async (mode) => {
          const created = await world();
          const locked = Promise.withResolvers<number>();
          const go = Promise.withResolvers<void>();
          const writing = db
            .$transaction(
              async (tx) => {
                expect(await lockRuntime(tx, created)).toBe(true);
                locked.resolve(await pidOf(tx));
                await go.promise;
                await writes[write](tx, created);
              },
              { timeout: 20_000 },
            )
            .then(() => "written", outcome);
          await Promise.race([locked.promise, writing]);
          const deletionPid = Promise.withResolvers<number>();
          let first = true;
          const deleting = removeBot(mode, created.sokoBotId, async (tx) => {
            if (first) {
              first = false;
              deletionPid.resolve(await pidOf(tx));
            }
            return tx;
          });
          try {
            await waitForLock(await deletionPid.promise);
          } finally {
            go.resolve();
          }
          // The count missed the row its snapshot predates. A usage row
          // fails the serializable cascade, and the retry counts it; a Job
          // meets the restrict key's own error, on base as on head.
          const expected =
            write === "usage row"
              ? (["tombstoned", "tombstoned"] as const)
              : (["foreign key", "live"] as const);
          expect(await Promise.all([deleting, writing])).toEqual([
            expected[0],
            "written",
          ]);
          expect(await botState(created)).toBe(expected[1]);
          expect(await raceRow(write, created)).toBe(true);
        },
        60_000,
      );

      it.each(modes)(
        "loses the runtime its authority when the deletion holds the bot first (%s)",
        async (mode) => {
          const created = await world();
          let writer: Promise<unknown> | undefined;
          const deleted = await removeBot(
            mode,
            created.sokoBotId,
            around("sokoBot", "delete", "after", async () => {
              const started = Promise.withResolvers<number>();
              writer = db
                .$transaction(
                  async (tx) => {
                    started.resolve(await pidOf(tx));
                    if (!(await lockRuntime(tx, created)))
                      return "authority lost";
                    await writes[write](tx, created);
                    return "written";
                  },
                  { timeout: 20_000 },
                )
                .then((value) => value, outcome);
              await waitForLock(await started.promise);
            }),
          );
          expect({ deleted, writer: await writer }).toEqual({
            deleted: "deleted",
            writer: "authority lost",
          });
          expect(await botState(created)).toBe("deleted");
          expect(await raceRow(write, created)).toBe(false);
        },
        60_000,
      );
    },
  );

  describe("the failed hire's Project", () => {
    /** Runs `run` once, after the first raw read of head's clean-up. */
    function afterFirstRead(run: () => Promise<void>): Wrap {
      let ran = false;
      return (tx) =>
        new Proxy(tx, {
          get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (property !== "$queryRaw") return value;
            return async (...args: unknown[]) => {
              const result = await Reflect.apply(value, target, args);
              if (!ran) {
                ran = true;
                await run();
              }
              return result;
            };
          },
        });
    }

    it.each(modes)(
      "a bot that moves to another Project and hires there does not refuse the clean-up (%s)",
      async (mode) => {
        const created = await world();
        const { id } = created;
        const moveThenHire = () =>
          db.$transaction(async (tx) => {
            await tx.$executeRaw`
              UPDATE ${sharedTable("soko_bot")} SET "projectId" = ${id("otherProject")}::uuid
              WHERE id = ${id("bot.project")}::uuid
            `;
            await seedJob(tx, network, {
              id: id("race.row"),
              agentId: id("agent"),
              workspaceId: id("workspace"),
              projectId: id("otherProject"),
              creatorSokoBotId: id("bot.project"),
            });
          });
        // Base has one statement: the move and hire commit before it. Head
        // reads first; they commit between its reads.
        const wrap =
          mode === "head"
            ? afterFirstRead(moveThenHire)
            : around("project", "delete", "before", moveThenHire);
        expect(await removeProject(mode, created.projectId, wrap)).toBe(
          "deleted",
        );
        expect(
          await db.project.findUnique({ where: { id: created.projectId } }),
        ).toBeNull();
        expect(
          await db.sokoBot.findUnique({
            where: { id: id("bot.project") },
            select: { projectId: true },
          }),
        ).toEqual({ projectId: id("otherProject") });
        expect(
          await db.$queryRaw`
            SELECT id, "creatorSokoBotId"::text AS creator FROM ${netTable(network, "Job")}
            WHERE id IN (${id("race.row")}, ${id("job.project")}) ORDER BY id = ${id("job.project")}
          `,
        ).toEqual([
          { id: id("race.row"), creator: id("bot.project") },
          { id: id("job.project"), creator: null },
        ]);
        for (const local of networks) {
          expect(
            await db.$queryRaw`
              SELECT
                EXISTS (SELECT 1 FROM ${netTable(local, "credit_bucket")} WHERE id = ${id("bucket.project")}) AS bucket,
                (SELECT "projectId"::text FROM ${netTable(local, "Job")} WHERE id = ${id("job.project")}) AS "projectJob"
            `,
          ).toEqual([{ bucket: false, projectJob: null }]);
        }
      },
      60_000,
    );

    it.each(modes)(
      "waits out a writer that holds the Project past one transaction budget, then deletes it (%s)",
      async (mode) => {
        const created = await world();
        const { id } = created;
        const held = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const writer = db.$transaction(
          async (tx) => {
            await tx.$executeRaw`
              UPDATE ${sharedTable("project")} SET name = 'renamed'
              WHERE id = ${created.projectId}::uuid
            `;
            held.resolve();
            await release.promise;
          },
          { timeout: 30_000 },
        );
        await held.promise;
        const cleanup = (
          mode === "head"
            ? deleteProjectInTransaction(db, created.projectId)
            : db.project.delete({ where: { id: created.projectId } })
        ).then(() => "deleted", outcome);
        try {
          await waitForAnyLock();
          // Longer than Prisma's 5 s interactive transaction budget.
          await new Promise((resolve) => setTimeout(resolve, 6_200));
        } finally {
          release.resolve();
          await writer;
        }
        expect(await cleanup).toBe("deleted");
        expect(
          await db.project.findUnique({ where: { id: created.projectId } }),
        ).toBeNull();
        for (const local of networks) {
          expect(
            await db.$queryRaw`
              SELECT id FROM ${netTable(local, "credit_bucket")} WHERE id = ${id("bucket.project")}
            `,
          ).toEqual([]);
        }
      },
      60_000,
    );

    it.each(modes)(
      "keeps a bot that moved out after the candidate read, with its usage (%s)",
      async (mode) => {
        const created = await world();
        const { id } = created;
        const moved = await removeProject(
          mode,
          created.projectId,
          around("project", "delete", "before", async () => {
            await db.$executeRaw`
              UPDATE ${sharedTable("soko_bot")} SET "projectId" = ${id("otherProject")}::uuid
              WHERE id = ${id("bot.project")}::uuid
            `;
          }),
        );
        expect(moved).toBe("deleted");
        expect(
          await db.sokoBot.findUnique({
            where: { id: id("bot.project") },
            select: { projectId: true },
          }),
        ).toEqual({ projectId: id("otherProject") });
        for (const local of networks) {
          expect(
            await db.$queryRaw`
              SELECT id FROM ${netTable(local, "soko_bot_usage")} WHERE id = ${id("usage.project")}
            `,
          ).toEqual([{ id: id("usage.project") }]);
          expect(
            await db.$queryRaw`
              SELECT id FROM ${netTable(local, "credit_bucket")} WHERE id = ${id("bucket.project")}
            `,
          ).toEqual([]);
        }
      },
      60_000,
    );

    it.each(modes)(
      "a Job the bot hires after the refusal check meets the key's refusal (%s)",
      async (mode) => {
        const created = await world();
        const { id } = created;
        const hired = await removeProject(
          mode,
          created.projectId,
          around("project", "delete", "before", async () => {
            await db.$transaction((tx) =>
              seedJob(tx, network, {
                id: id("race.row"),
                agentId: id("agent"),
                workspaceId: id("workspace"),
                creatorSokoBotId: id("bot.project"),
              }),
            );
          }),
        );
        expect(hired).toBe("foreign key");
        expect(
          await db.project.findUnique({
            where: { id: created.projectId },
            select: { id: true },
          }),
        ).toEqual({ id: created.projectId });
      },
      60_000,
    );

    it.each(modes)(
      "a second clean-up of the same Project, started after the first's delete, finds it gone (%s)",
      async (mode) => {
        const created = await world();
        let second: Promise<unknown> | undefined;
        const first = await removeProject(
          mode,
          created.projectId,
          around("project", "delete", "after", async () => {
            second = removeProject(mode, created.projectId, (tx) => tx);
            // Head's transaction holds the Project row until it commits;
            // base's single statement has committed already.
            if (mode === "head") await waitForAnyLock();
          }),
        );
        expect({ first, second: await second }).toEqual({
          first: "deleted",
          second: "P2025",
        });
      },
      60_000,
    );

    it.each(modes)(
      "a second clean-up that read before the first committed finds the Project gone (%s)",
      async (mode) => {
        const created = await world();
        const second = await removeProject(
          mode,
          created.projectId,
          around("project", "delete", "before", async () => {
            expect(
              await removeProject(mode, created.projectId, (tx) => tx),
            ).toBe("deleted");
          }),
        );
        expect(second).toBe("P2025");
      },
      60_000,
    );
  });

  describe("the Soko Bot deletion beside a delete of its Project", () => {
    it.each(modes)(
      "the Project delete waits on the tombstone, then takes it (%s)",
      async (mode) => {
        const created = await world();
        const { id } = created;
        let projectDelete: Promise<unknown> | undefined;
        const deleted = await removeBot(
          mode,
          id("bot.project"),
          // `bot.project` has usage rows, so it is tombstoned.
          around("sokoBot", "update", "after", async () => {
            const started = Promise.withResolvers<number>();
            projectDelete = db
              .$transaction(async (tx) => {
                started.resolve(await pidOf(tx));
                await tx.project.delete({ where: { id: created.projectId } });
              })
              .then(() => "deleted", outcome);
            await waitForLock(await started.promise);
          }),
        );
        expect({ deleted, project: await projectDelete }).toEqual({
          deleted: "tombstoned",
          project: "deleted",
        });
        expect(
          await db.sokoBot.findUnique({ where: { id: id("bot.project") } }),
        ).toBeNull();
      },
      60_000,
    );

    it.each(modes)(
      "the bot deletion finds the bot gone when the Project delete commits first (%s)",
      async (mode) => {
        const created = await world();
        const { id } = created;
        const go = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const projectDelete = db
          .$transaction(
            async (tx) => {
              await tx.project.delete({ where: { id: created.projectId } });
              held.resolve();
              await go.promise;
            },
            { timeout: 20_000 },
          )
          .then(() => "deleted", outcome);
        await held.promise;
        const deletionPid = Promise.withResolvers<number>();
        let first = true;
        const deleting = removeBot(mode, id("bot.project"), async (tx) => {
          if (first) {
            first = false;
            deletionPid.resolve(await pidOf(tx));
          }
          return tx;
        });
        try {
          await waitForLock(await deletionPid.promise);
        } finally {
          go.resolve();
        }
        expect(await Promise.all([deleting, projectDelete])).toEqual([
          404,
          "deleted",
        ]);
      },
      60_000,
    );
  });
});

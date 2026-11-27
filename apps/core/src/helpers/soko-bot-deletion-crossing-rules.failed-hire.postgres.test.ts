import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";
import { Client, Pool, type PoolClient } from "pg";
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
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";
import {
  digests,
  dropFlowCrossingKeys,
} from "@/test-fixtures/crossing-key-comparison";
import {
  newSokoBotDeletionWorld,
  type SokoBotDeletionWorld,
  seedSokoBotDeletionWorld,
} from "@/test-fixtures/soko-bot-deletion-world";
import { insertRow, seedJob } from "@/test-fixtures/user-deletion-world";

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

type Tx = Prisma.TransactionClient;
type Client_ = typeof import("@/lib/db/prisma").default;
type Mode = "base" | "head";

const core = vi.hoisted(() => ({ preprodOn: false }));

// Preprod off and on on the same split database; the env flag is read once.
vi.mock("@/lib/network", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/network")>();
  return {
    ...actual,
    networksThatAreOn: () =>
      core.preprodOn ? actual.NETWORKS : (["mainnet"] as const),
  };
});

/** The Network schemas this database has, whether Preprod is on or not. */
const networks: Network[] = onSplitLayout
  ? ["mainnet", "preprod"]
  : ["mainnet"];
const layouts = onSplitLayout
  ? (["Preprod off", "Preprod on"] as const)
  : (["today's layout"] as const);
const modes = ["base", "head"] as const;
const AT = "2026-01-01T00:00:00";

function outcome(error: {
  code?: string;
  meta?: {
    code?: string;
    driverAdapterError?: { cause?: { originalCode?: string } };
  };
}) {
  const pg = error.meta?.driverAdapterError?.cause?.originalCode;
  if (error.code === "P2003" || pg === "23503" || pg === "23001")
    return "foreign key";
  if (error.code === "P2034" || pg === "40P01" || error.meta?.code === "40P01")
    return "deadlock";
  // origin/main's Prisma delete and the statement name it differently.
  if (error.code === "P2025" || error.code === "PROJECT_NOT_FOUND")
    return "gone";
  return error.code ?? String(error);
}

describe.runIf(ON_POSTGRES)("the failed CMO hire's clean-up", () => {
  let db: Client_;
  let cleanUp: typeof import("./soko-bot-deletion-crossing-rules").deleteFailedHireProject;

  beforeAll(async () => {
    // Lets fixtures write Preprod rows; `core.preprodOn` decides what Core sweeps.
    vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
    ({ default: db } = await import("@/lib/db/prisma"));
    ({ deleteFailedHireProject: cleanUp } = await import(
      "./soko-bot-deletion-crossing-rules"
    ));
  }, 60_000);

  afterAll(() => {
    core.preprodOn = false;
    vi.unstubAllEnvs();
  });

  /** `origin/main`'s clean-up: Prisma's one `DELETE`, the keys do the rest. */
  function removeProject(mode: Mode, client: Tx | Client_, projectId: string) {
    const run =
      mode === "base"
        ? client.project.delete({ where: { id: projectId } })
        : cleanUp(client, projectId);
    return run.then(() => "deleted", outcome);
  }

  describe("end state against origin/main's DELETE", () => {
    // Needs its own PostgreSQL database: it drops keys and compares every
    // table, isolated by CI's POSTGRES_TEST_DATABASE_PER_WORKER option.
    async function inWorld(
      hiredJob: boolean,
      run: (tx: Tx, world: SokoBotDeletionWorld) => Promise<void>,
    ) {
      const rollback = new Error("roll back test world");
      try {
        await db.$transaction(
          async (tx) => {
            const world = newSokoBotDeletionWorld();
            await seedSokoBotDeletionWorld(tx, networks, world, "nothing");
            if (hiredJob) {
              for (const network of networks) {
                await seedJob(tx, network, {
                  id: world.id("job.hired"),
                  agentId: world.id("agent"),
                  workspaceId: world.id("workspace"),
                  creatorSokoBotId: world.id("bot.project"),
                });
              }
            }
            await tx.$executeRaw`SAVEPOINT before_cleanup`;
            await run(tx, world);
            throw rollback;
          },
          { timeout: 120_000 },
        );
      } catch (error) {
        if (error !== rollback) throw error;
      }
    }

    /** A digest of the History rows of every Network but `network`. */
    async function historyOutside(tx: Tx, network: Network) {
      const [{ digest }] = await tx.$queryRaw<{ digest: string }[]>`
        SELECT md5(COALESCE(string_agg(md5(h::text), '' ORDER BY md5(h::text)), '')) AS digest
        FROM ${sharedTable("history")} h
        WHERE h.network IS DISTINCT FROM ${network}
      `;
      return digest;
    }

    async function attempt(tx: Tx, mode: Mode, projectId: string) {
      const result = await removeProject(mode, tx, projectId);
      // A refused statement aborts the transaction; the error is the result.
      if (result !== "deleted")
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT before_cleanup`;
      return result;
    }

    it.each(layouts)(
      "deletes what origin/main deletes, with the keys and without them, on %s",
      async (layout) => {
        core.preprodOn = layout === "Preprod on";
        const on = core.preprodOn ? networks : (["mainnet"] as Network[]);
        await inWorld(false, async (tx, world) => {
          const seeded = await digests(tx);
          expect(await attempt(tx, "base", world.projectId)).toBe("deleted");
          const base = await digests(tx);
          const baseHistory = await historyOutside(tx, "preprod");
          expect(base).not.toEqual(seeded);
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT before_cleanup`;

          // While the keys exist they do the work, and no sweep changes a row.
          expect(await cleanUp(tx, world.projectId)).toEqual({
            "credit_bucket.projectId": 0,
            "Job.projectId": 0,
            "soko_bot_usage.sokoBotId": 0,
          });
          expect(await digests(tx)).toEqual(base);
          await expect(cleanUp(tx, world.projectId)).rejects.toMatchObject({
            code: "PROJECT_NOT_FOUND",
          });
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT before_cleanup`;

          await dropFlowCrossingKeys(tx, "failed CMO hire", networks);
          // Without them each sweep changes its row, 1 per Network on.
          expect(await cleanUp(tx, world.projectId)).toEqual({
            "credit_bucket.projectId": on.length,
            "Job.projectId": on.length,
            "soko_bot_usage.sokoBotId": on.length,
          });
          const withoutKeys = await digests(tx);
          if (on.length === networks.length) {
            expect(withoutKeys).toEqual(base);
            return;
          }
          // A Network that is off is not swept (decision D2): its tables stay
          // as seeded, and History lacks what its Job trigger wrote for
          // them. Every other table ends as origin/main's.
          const preprod = `${testSchemaNames().DATABASE_SCHEMA_PREPROD}.`;
          const history = `${testSchemaNames().DATABASE_SCHEMA_SHARED}.history`;
          expect(withoutKeys.filter(({ name }) => name !== history)).toEqual(
            base
              .filter(({ name }) => name !== history)
              .map((row) =>
                row.name.startsWith(preprod)
                  ? seeded.find(({ name }) => name === row.name)
                  : row,
              ),
          );
          expect(await historyOutside(tx, "preprod")).toEqual(baseHistory);
        });
      },
      120_000,
    );

    it.each(layouts)(
      "refuses a Job hired by the Project's bot and changes nothing, with the keys and without them, on %s",
      async (layout) => {
        core.preprodOn = layout === "Preprod on";
        await inWorld(true, async (tx, world) => {
          const seeded = await digests(tx);
          expect(await attempt(tx, "base", world.projectId)).toBe(
            "foreign key",
          );
          expect(await digests(tx)).toEqual(seeded);
          expect(await attempt(tx, "head", world.projectId)).toBe(
            "PROJECT_DELETION_SOKO_BOT_HIRED_JOB",
          );
          expect(await digests(tx)).toEqual(seeded);
          await dropFlowCrossingKeys(tx, "failed CMO hire", networks);
          expect(await attempt(tx, "head", world.projectId)).toBe(
            "PROJECT_DELETION_SOKO_BOT_HIRED_JOB",
          );
          expect(await digests(tx)).toEqual(seeded);
        });
      },
      120_000,
    );
  });

  describe("on several connections", () => {
    const worlds: SokoBotDeletionWorld[] = [];
    const sessions: Client[] = [];

    beforeAll(() => {
      core.preprodOn = onSplitLayout;
    });

    afterEach(async () => {
      for (const session of sessions.splice(0))
        await session.end().catch(() => undefined);
      for (const { id } of worlds.splice(0)) {
        for (const local of networks) {
          await db.$executeRaw`DELETE FROM ${netTable(local, "Job")} WHERE "agentId" = ${id("agent")}`;
          await db.$executeRaw`DELETE FROM ${netTable(local, "soko_bot_usage")} WHERE "userId" = ${id("ada")}`;
          await db.$executeRaw`DELETE FROM ${netTable(local, "credit_bucket")} WHERE "userId" = ${id("ada")}`;
          await db.$executeRaw`DELETE FROM ${netTable(local, "Transaction")} WHERE "userId" = ${id("ada")}`;
          await db.$executeRaw`DELETE FROM ${netTable(local, "Agent")} WHERE id = ${id("agent")}`;
          await db.$executeRaw`DELETE FROM ${netTable(local, "AgentPricing")} WHERE id = ${id("agent")}`;
        }
        await db.project.deleteMany({
          where: { workspaceId: id("workspace") },
        });
        await db.sokoBot.deleteMany({
          where: { workspaceId: id("workspace") },
        });
        await db.$executeRaw`DELETE FROM ${sharedTable("task")} WHERE "workspaceId" = ${id("workspace")}::uuid`;
        await db.user.deleteMany({
          where: { id: { in: [id("ada"), id("member")] } },
        });
      }
    }, 60_000);

    /** A committed world: the Project, its bot with a running turn, and the rest. */
    async function world() {
      const created = newSokoBotDeletionWorld();
      worlds.push(created);
      await db.$transaction(
        async (tx) => {
          await seedSokoBotDeletionWorld(tx, networks, created, "nothing");
          await insertRow(tx, sharedTable("soko_bot_turn"), {
            id: created.id("turn"),
            sokoBotId: created.id("bot.project"),
            workspaceId: created.id("workspace"),
            source: "CHAT",
            status: "RUNNING",
            userMessage: "Test turn",
            clientTurnId: created.id("turn"),
            capabilityNames: [],
            deadlineAt: "2030-01-01T00:00:00",
            updatedAt: AT,
          });
          // Rows of the Project and of its bot that the keys reach inside
          // `shared` and inside a Network: a member's pin and the bot she
          // created (an account deletion clears both), a Task, the bot's
          // memory, and each bucket's consumption.
          await insertRow(tx, sharedTable("user"), {
            id: created.id("member"),
            name: "member",
            email: `${created.id("member")}@example.test`,
            emailVerified: true,
            createdAt: AT,
            updatedAt: AT,
          });
          await tx.$executeRaw`
            UPDATE ${sharedTable("soko_bot")} SET "createdByUserId" = ${created.id("member")}
            WHERE id = ${created.id("bot.project")}::uuid
          `;
          await insertRow(tx, sharedTable("project_star"), {
            id: created.id("pin"),
            userId: created.id("member"),
            projectId: created.projectId,
          });
          await insertRow(tx, sharedTable("task"), {
            id: created.id("task"),
            name: "Task",
            workspaceId: created.id("workspace"),
            projectId: created.projectId,
            updatedAt: AT,
          });
          await insertRow(tx, sharedTable("soko_bot_memory_revision"), {
            id: created.id("memory"),
            sokoBotId: created.id("bot.project"),
            version: 1,
            hash: "hash",
            markdown: "memory",
            source: "test",
          });
          for (const network of networks) {
            await insertRow(tx, netTable(network, "credit_consumption"), {
              id: created.id("consumption"),
              amount: 1,
              bucketId: created.id("bucket.project"),
              transactionId: created.id("charge.project"),
            });
          }
        },
        { timeout: 30_000 },
      );
      return created;
    }

    /** A plain connection that holds its locks until told otherwise. */
    async function session() {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      client.on("error", () => undefined);
      await client.connect();
      sessions.push(client);
      const {
        rows: [{ pid }],
      } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const run = (text: string, values: unknown[] = []) =>
        client.query(text, values).then(
          () => "ok",
          (error: { code?: string }) =>
            error.code === "40P01" ? "deadlock" : String(error.code),
        );
      return { client, pid, run };
    }

    const t = (table: Prisma.Sql) => table.sql;

    /** The backend `holder` blocks, once it waits. */
    async function blockedBy(holder: number) {
      for (let attempt = 0; attempt < 500; attempt++) {
        const rows = await db.$queryRaw<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity
          WHERE ${holder}::int = ANY(pg_blocking_pids(pid))
        `;
        if (rows[0]) return rows[0].pid;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Expected a connection waiting on the holder");
    }

    async function rows({ id, projectId }: SokoBotDeletionWorld) {
      const state: Record<string, unknown> = {
        project: Boolean(
          await db.project.findUnique({ where: { id: projectId } }),
        ),
        bot: (
          await db.sokoBot.findUnique({
            where: { id: id("bot.project") },
            select: { projectId: true },
          })
        )?.projectId,
      };
      for (const network of core.preprodOn ? networks : ["mainnet" as const]) {
        const [row] = await db.$queryRaw<
          { bucket: boolean; usage: boolean; job: string | null }[]
        >`
          SELECT
            EXISTS (SELECT 1 FROM ${netTable(network, "credit_bucket")} WHERE id = ${id("bucket.project")}) AS bucket,
            EXISTS (SELECT 1 FROM ${netTable(network, "soko_bot_usage")} WHERE id = ${id("usage.project")}) AS usage,
            (SELECT "projectId"::text FROM ${netTable(network, "Job")} WHERE id = ${id("job.project")}) AS job
        `;
        state[network] = row;
      }
      return state;
    }

    const gone = () => ({
      project: false,
      bot: undefined,
      ...Object.fromEntries(
        (core.preprodOn ? networks : ["mainnet"]).map((network) => [
          network,
          { bucket: false, usage: false, job: null },
        ]),
      ),
    });

    async function expectSurvivors({ id }: SokoBotDeletionWorld) {
      expect(
        await db.sokoBot.findUnique({
          where: { id: id("bot.other") },
          select: { projectId: true },
        }),
      ).toEqual({ projectId: id("otherProject") });
      const [row] = await db.$queryRaw<{ bucket: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM ${netTable("mainnet", "credit_bucket")}
          WHERE id = ${id("bucket.other")}) AS bucket
      `;
      expect(row).toEqual({ bucket: true });
    }

    it.each(modes)(
      "%s: the server finishes the clean-up when the client's connection is lost while it waits",
      async (mode) => {
        const w = await world();
        const holder = await session();
        await holder.run("BEGIN");
        await holder.run(
          `SELECT 1 FROM ${t(sharedTable("soko_bot"))} WHERE id = $1 FOR UPDATE`,
          [w.id("bot.project")],
        );
        // A client of its own, so its one connection can be cut.
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 1,
        });
        let connection: PoolClient | undefined;
        pool.on("connect", (client) => {
          connection = client;
          client.on("error", () => undefined);
        });
        pool.on("error", () => undefined);
        const own = createPrismaClient(pool, {
          schema: testSchemaNames().DATABASE_SCHEMA_SHARED,
        });
        const [{ pid }] = await own.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        const pending = removeProject(mode, own, w.projectId);
        expect(await blockedBy(holder.pid)).toBe(pid);
        connection?.connection.stream.destroy();
        expect(await pending).not.toBe("deleted");
        // The server still runs it, waiting on the same holder.
        expect(await blockedBy(holder.pid)).toBe(pid);
        await holder.run("COMMIT");
        for (let attempt = 0; attempt < 500; attempt++) {
          const [{ running }] = await db.$queryRaw<{ running: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = ${pid}::int) AS running
          `;
          if (!running) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await pool.end().catch(() => undefined);
        expect(await rows(w)).toEqual(gone());
        await expectSurvivors(w);
      },
      60_000,
    );

    it.each(modes)(
      "%s: a hire by the Project's bot while the clean-up waits is refused by the key, not seen by the refusal",
      async (mode) => {
        const w = await world();
        const holder = await session();
        await holder.run("BEGIN");
        await holder.run(
          `UPDATE ${t(sharedTable("project"))} SET name = 'held' WHERE id = $1::uuid`,
          [w.projectId],
        );
        const pending = removeProject(mode, db, w.projectId);
        await blockedBy(holder.pid);
        const hirer = await session();
        expect(
          await hirer.run(
            `INSERT INTO ${t(netTable("mainnet", "Job"))} (id, "updatedAt", "agentId", "agentJobId", "jobType", "workspaceId", "creatorSokoBotId")
             VALUES ($1, now(), $2, $1, 'FREE', $3::uuid, $4::uuid)`,
            [
              w.id("job.late"),
              w.id("agent"),
              w.id("workspace"),
              w.id("bot.project"),
            ],
          ),
        ).toBe("ok");
        await holder.run("COMMIT");
        expect(await pending).toBe("foreign key");
        expect(await rows(w)).toMatchObject({
          project: true,
          bot: w.projectId,
          mainnet: { bucket: true, usage: true, job: w.projectId },
        });
      },
      60_000,
    );

    it.each(modes)(
      "%s: a bot that leaves the Project and hires elsewhere while the clean-up waits keeps its rows",
      async (mode) => {
        const w = await world();
        const holder = await session();
        await holder.run("BEGIN");
        await holder.run(
          `UPDATE ${t(sharedTable("project"))} SET name = 'held' WHERE id = $1::uuid`,
          [w.projectId],
        );
        const pending = removeProject(mode, db, w.projectId);
        await blockedBy(holder.pid);
        const mover = await session();
        await mover.run("BEGIN");
        await mover.run(
          `UPDATE ${t(sharedTable("soko_bot"))} SET "projectId" = $2::uuid WHERE id = $1::uuid`,
          [w.id("bot.project"), w.id("otherProject")],
        );
        await mover.run(
          `INSERT INTO ${t(netTable("mainnet", "Job"))} (id, "updatedAt", "agentId", "agentJobId", "jobType", "workspaceId", "projectId", "creatorSokoBotId")
           VALUES ($1, now(), $2, $1, 'FREE', $3::uuid, $4::uuid, $5::uuid)`,
          [
            w.id("job.moved"),
            w.id("agent"),
            w.id("workspace"),
            w.id("otherProject"),
            w.id("bot.project"),
          ],
        );
        expect(await mover.run("COMMIT")).toBe("ok");
        await holder.run("COMMIT");
        expect(await pending).toBe("deleted");
        expect(await rows(w)).toMatchObject({
          project: false,
          bot: w.id("otherProject"),
          mainnet: { bucket: false, usage: true, job: null },
        });
      },
      60_000,
    );

    it.each(modes)(
      "%s: a bot that joins the Project while the clean-up waits goes with it",
      async (mode) => {
        const w = await world();
        // A bot of the other Project with a usage row and no hired Job.
        await db.$transaction(async (tx) => {
          await insertRow(tx, sharedTable("soko_bot"), {
            id: w.id("bot.late"),
            workspaceId: w.id("workspace"),
            projectId: w.id("otherProject"),
            updatedAt: AT,
          });
          await insertRow(tx, netTable("mainnet", "Transaction"), {
            id: w.id("charge.late"),
            userId: w.id("ada"),
            amount: 10,
            updatedAt: AT,
          });
          await insertRow(tx, netTable("mainnet", "soko_bot_usage"), {
            id: w.id("usage.late"),
            userId: w.id("ada"),
            sokoBotId: w.id("bot.late"),
            transactionId: w.id("charge.late"),
            idempotencyKey: w.id("usage.late"),
            cents: 1,
            updatedAt: AT,
          });
        });
        const holder = await session();
        await holder.run("BEGIN");
        await holder.run(
          `UPDATE ${t(sharedTable("project"))} SET name = 'held' WHERE id = $1::uuid`,
          [w.projectId],
        );
        const pending = removeProject(mode, db, w.projectId);
        await blockedBy(holder.pid);
        const mover = await session();
        expect(
          await mover.run(
            `UPDATE ${t(sharedTable("soko_bot"))} SET "projectId" = $2::uuid WHERE id = $1::uuid`,
            [w.id("bot.late"), w.projectId],
          ),
        ).toBe("ok");
        await holder.run("COMMIT");
        expect(await pending).toBe("deleted");
        // The key takes the late bot and its usage; after ticket 54 its usage
        // stays behind (decision D6, the parent-lock slices).
        expect(
          await db.sokoBot.findUnique({ where: { id: w.id("bot.late") } }),
        ).toBeNull();
        const [row] = await db.$queryRaw<{ usage: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM ${netTable("mainnet", "soko_bot_usage")}
            WHERE id = ${w.id("usage.late")}) AS usage
        `;
        expect(row).toEqual({ usage: false });
      },
      60_000,
    );

    /**
     * The rows the clean-up locks, in the order it locks them: a holder locks
     * one row, and once the clean-up waits there, every other row is tried
     * with NOWAIT; the ones it holds already come before.
     */
    async function lockOrder(mode: Mode) {
      const lockable = (w: SokoBotDeletionWorld) => {
        const list: [string, Prisma.Sql, string][] = [
          ["project", sharedTable("project"), w.projectId],
          ["bot", sharedTable("soko_bot"), w.id("bot.project")],
          ["turn", sharedTable("soko_bot_turn"), w.id("turn")],
          ["pin", sharedTable("project_star"), w.id("pin")],
          ["task", sharedTable("task"), w.id("task")],
          ["memory", sharedTable("soko_bot_memory_revision"), w.id("memory")],
        ];
        for (const network of networks) {
          list.push(
            [
              `${network} Job link`,
              netTable(network, "Job"),
              w.id("job.project"),
            ],
            [
              `${network} bucket`,
              netTable(network, "credit_bucket"),
              w.id("bucket.project"),
            ],
            [
              `${network} usage`,
              netTable(network, "soko_bot_usage"),
              w.id("usage.project"),
            ],
            [
              `${network} consumption`,
              netTable(network, "credit_consumption"),
              w.id("consumption"),
            ],
          );
        }
        return list;
      };
      const before: Record<string, number> = {};
      for (const [name] of lockable(newSokoBotDeletionWorld())) {
        const w = await world();
        const rows = lockable(w);
        const [, table, id] = rows.find(([row]) => row === name) ?? [];
        const holder = await session();
        await holder.run("BEGIN");
        await holder.run(
          `SELECT 1 FROM ${t(table as Prisma.Sql)} WHERE id::text = $1 FOR UPDATE`,
          [id],
        );
        const pending = removeProject(mode, db, w.projectId);
        await blockedBy(holder.pid);
        const probe = await session();
        let held = 0;
        for (const [other, otherTable, otherId] of rows) {
          if (other === name) continue;
          await probe.run("BEGIN");
          const result = await probe.run(
            `SELECT 1 FROM ${t(otherTable)} WHERE id::text = $1 FOR UPDATE NOWAIT`,
            [otherId],
          );
          await probe.run("ROLLBACK");
          if (result === "55P03") held++;
        }
        await holder.run("COMMIT");
        expect(await pending).toBe("deleted");
        before[name] = held;
      }
      return Object.keys(before).sort((a, b) => before[a] - before[b]);
    }

    it("takes its row locks in origin/main's order", async () => {
      const base = await lockOrder("base");
      const head = await lockOrder("head");
      expect(head).toEqual(base);
    }, 120_000);

    /**
     * The lock orders of section 3d of the design note. Project close
     * (`project-close-lifecycle.service.ts`): Workspace, Project, then its
     * bots, `FOR UPDATE`. A Soko Bot turn (`authorization.ts`): the turn, then
     * its bot; or the bot, then a write whose key locks the Workspace.
     * Billing (`soko-bot-billing.service.ts`): a consumption on the bucket,
     * then the usage row on the bot. A Soko Bot deletion: the bot, then its
     * Project's bucket. An account deletion (`user-deletion-tasks.ts`, the
     * user's delete): the member's pin, then the bot she created
     * (`createdByUserId` set null). An Organization or personal Workspace
     * deletion (`lockWorkspaceCalendarForErasure` in `calendar-erasure.ts`):
     * the Workspace, its Projects, their Tasks, then their deletes; the
     * Organization's own row before it is one the clean-up never touches.
     * Each schedule must end as it does on origin/main.
     */
    const schedules = {
      "an account deletion that deletes the member's pin first": async (
        w: SokoBotDeletionWorld,
        mode: Mode,
      ) => {
        const account = await session();
        await account.run("BEGIN");
        await account.run(
          `DELETE FROM ${t(sharedTable("project_star"))} WHERE "userId" = $1`,
          [w.id("member")],
        );
        const pending = removeProject(mode, db, w.projectId);
        await blockedBy(account.pid);
        const bot = await account.run(
          `UPDATE ${t(sharedTable("soko_bot"))} SET "createdByUserId" = NULL WHERE "createdByUserId" = $1`,
          [w.id("member")],
        );
        await account.run(bot === "ok" ? "COMMIT" : "ROLLBACK");
        return { cleanUp: await pending, account: bot };
      },
      "an account deletion that starts while the clean-up holds the pin":
        async (w: SokoBotDeletionWorld, mode: Mode) => {
          const holder = await session();
          await holder.run("BEGIN");
          await holder.run(
            `UPDATE ${t(netTable("mainnet", "credit_bucket"))} SET amount = amount WHERE id = $1`,
            [w.id("bucket.project")],
          );
          const pending = removeProject(mode, db, w.projectId);
          const cleanUpPid = await blockedBy(holder.pid);
          const account = await session();
          await account.run("BEGIN");
          const pin = account.run(
            `DELETE FROM ${t(sharedTable("project_star"))} WHERE "userId" = $1`,
            [w.id("member")],
          );
          expect(await blockedBy(cleanUpPid)).toBe(account.pid);
          await holder.run("COMMIT");
          const result = { cleanUp: await pending, account: await pin };
          const bot = await account.run(
            `UPDATE ${t(sharedTable("soko_bot"))} SET "createdByUserId" = NULL WHERE "createdByUserId" = $1`,
            [w.id("member")],
          );
          await account.run("COMMIT");
          return { ...result, bot };
        },
      "a Workspace deletion that holds the Workspace and Project first": async (
        w: SokoBotDeletionWorld,
        mode: Mode,
      ) => {
        const erasure = await session();
        await erasure.run("BEGIN");
        await erasure.run(
          `SELECT 1 FROM ${t(sharedTable("workspace"))} WHERE id = $1::uuid FOR UPDATE`,
          [w.id("workspace")],
        );
        await erasure.run(
          `SELECT 1 FROM ${t(sharedTable("project"))} WHERE "workspaceId" = $1::uuid ORDER BY id FOR UPDATE`,
          [w.id("workspace")],
        );
        const pending = removeProject(mode, db, w.projectId);
        await blockedBy(erasure.pid);
        await erasure.run(
          `SELECT 1 FROM ${t(sharedTable("task"))} WHERE "workspaceId" = $1::uuid ORDER BY id FOR UPDATE`,
          [w.id("workspace")],
        );
        await erasure.run(
          `DELETE FROM ${t(sharedTable("task"))} WHERE "workspaceId" = $1::uuid`,
          [w.id("workspace")],
        );
        const deleted = await erasure.run(
          `DELETE FROM ${t(sharedTable("project"))} WHERE id = $1::uuid`,
          [w.projectId],
        );
        await erasure.run(deleted === "ok" ? "COMMIT" : "ROLLBACK");
        return { cleanUp: await pending, erasure: deleted };
      },
      "a Workspace deletion that starts while the clean-up holds the Project":
        async (w: SokoBotDeletionWorld, mode: Mode) => {
          const holder = await session();
          await holder.run("BEGIN");
          await holder.run(
            `SELECT 1 FROM ${t(sharedTable("soko_bot"))} WHERE id = $1::uuid FOR UPDATE`,
            [w.id("bot.project")],
          );
          const pending = removeProject(mode, db, w.projectId);
          const cleanUpPid = await blockedBy(holder.pid);
          const erasure = await session();
          await erasure.run("BEGIN");
          await erasure.run(
            `SELECT 1 FROM ${t(sharedTable("workspace"))} WHERE id = $1::uuid FOR UPDATE`,
            [w.id("workspace")],
          );
          const projects = erasure.run(
            `SELECT 1 FROM ${t(sharedTable("project"))} WHERE "workspaceId" = $1::uuid ORDER BY id FOR UPDATE`,
            [w.id("workspace")],
          );
          expect(await blockedBy(cleanUpPid)).toBe(erasure.pid);
          await holder.run("COMMIT");
          const result = { cleanUp: await pending, erasure: await projects };
          const tasks = await erasure.run(
            `SELECT 1 FROM ${t(sharedTable("task"))} WHERE "workspaceId" = $1::uuid ORDER BY id FOR UPDATE`,
            [w.id("workspace")],
          );
          await erasure.run("ROLLBACK");
          return { ...result, tasks };
        },
      "a Project close that holds the Project first": async (
        w: SokoBotDeletionWorld,
        mode: Mode,
      ) => {
        const close = await session();
        await close.run("BEGIN");
        await close.run(
          `SELECT 1 FROM ${t(sharedTable("workspace"))} WHERE id = $1::uuid FOR UPDATE`,
          [w.id("workspace")],
        );
        await close.run(
          `SELECT 1 FROM ${t(sharedTable("project"))} WHERE id = $1::uuid FOR UPDATE`,
          [w.projectId],
        );
        const pending = removeProject(mode, db, w.projectId);
        await blockedBy(close.pid);
        const bots = await close.run(
          `SELECT id FROM ${t(sharedTable("soko_bot"))} WHERE "projectId" = $1::uuid ORDER BY id FOR UPDATE`,
          [w.projectId],
        );
        await close.run("COMMIT");
        return { cleanUp: await pending, close: bots };
      },
      "a Project close that starts while the clean-up holds the Project":
        async (w: SokoBotDeletionWorld, mode: Mode) => {
          const holder = await session();
          await holder.run("BEGIN");
          await holder.run(
            `SELECT 1 FROM ${t(sharedTable("soko_bot"))} WHERE id = $1::uuid FOR UPDATE`,
            [w.id("bot.project")],
          );
          const pending = removeProject(mode, db, w.projectId);
          const cleanUpPid = await blockedBy(holder.pid);
          const close = await session();
          await close.run("BEGIN");
          await close.run(
            `SELECT 1 FROM ${t(sharedTable("workspace"))} WHERE id = $1::uuid FOR UPDATE`,
            [w.id("workspace")],
          );
          const project = close.run(
            `SELECT 1 FROM ${t(sharedTable("project"))} WHERE id = $1::uuid FOR UPDATE`,
            [w.projectId],
          );
          expect(await blockedBy(cleanUpPid)).toBe(close.pid);
          await holder.run("COMMIT");
          const result = { cleanUp: await pending, close: await project };
          await close.run("COMMIT");
          return result;
        },
      "a turn that holds its turn, then asks for its bot": async (
        w: SokoBotDeletionWorld,
        mode: Mode,
      ) => {
        const turn = await session();
        await turn.run("BEGIN");
        await turn.run(
          `SELECT 1 FROM ${t(sharedTable("soko_bot_turn"))} WHERE id = $1::uuid FOR UPDATE`,
          [w.id("turn")],
        );
        const pending = removeProject(mode, db, w.projectId);
        await blockedBy(turn.pid);
        const bot = await turn.run(
          `SELECT 1 FROM ${t(sharedTable("soko_bot"))} WHERE id = $1::uuid FOR UPDATE`,
          [w.id("bot.project")],
        );
        await turn.run(bot === "ok" ? "COMMIT" : "ROLLBACK");
        return { cleanUp: await pending, turn: bot };
      },
      "a turn that holds its bot, then writes in the Workspace": async (
        w: SokoBotDeletionWorld,
        mode: Mode,
      ) => {
        const turn = await session();
        await turn.run("BEGIN");
        await turn.run(
          `SELECT 1 FROM ${t(sharedTable("soko_bot"))} WHERE id = $1::uuid FOR UPDATE`,
          [w.id("bot.project")],
        );
        const pending = removeProject(mode, db, w.projectId);
        await blockedBy(turn.pid);
        const workspace = await turn.run(
          `SELECT 1 FROM ${t(sharedTable("workspace"))} WHERE id = $1::uuid FOR KEY SHARE`,
          [w.id("workspace")],
        );
        await turn.run("COMMIT");
        return { cleanUp: await pending, turn: workspace };
      },
      "a turn that asks for its turn and bot while the clean-up waits on a bucket":
        async (w: SokoBotDeletionWorld, mode: Mode) => {
          const holder = await session();
          await holder.run("BEGIN");
          await holder.run(
            `UPDATE ${t(netTable("mainnet", "credit_bucket"))} SET amount = amount WHERE id = $1`,
            [w.id("bucket.project")],
          );
          const pending = removeProject(mode, db, w.projectId);
          await blockedBy(holder.pid);
          const turn = await session();
          await turn.run("BEGIN");
          const turnRow = turn.run(
            `SELECT 1 FROM ${t(sharedTable("soko_bot_turn"))} WHERE id = $1::uuid FOR UPDATE`,
            [w.id("turn")],
          );
          const bot = turn.run(
            `SELECT 1 FROM ${t(sharedTable("soko_bot"))} WHERE id = $1::uuid FOR UPDATE`,
            [w.id("bot.project")],
          );
          await new Promise((resolve) => setTimeout(resolve, 300));
          await holder.run("COMMIT");
          // Past deadlock_timeout (1 s), so a cycle has been broken by now.
          await new Promise((resolve) => setTimeout(resolve, 2_500));
          const botNow = await Promise.race([
            bot,
            new Promise((resolve) => setTimeout(() => resolve("waiting"), 10)),
          ]);
          await turn.run("ROLLBACK");
          return { cleanUp: await pending, turn: await turnRow, bot: botNow };
        },
      "billing that records a consumption, then the bot's usage": async (
        w: SokoBotDeletionWorld,
        mode: Mode,
      ) => {
        const billing = await session();
        await billing.run("BEGIN");
        await billing.run(
          `INSERT INTO ${t(netTable("mainnet", "Transaction"))} (id, "updatedAt", amount, "userId") VALUES ($1, now(), -1, $2)`,
          [w.id("race.charge"), w.id("ada")],
        );
        await billing.run(
          `INSERT INTO ${t(netTable("mainnet", "credit_consumption"))} (id, amount, "bucketId", "transactionId") VALUES ($1, 1, $2, $1)`,
          [w.id("race.charge"), w.id("bucket.project")],
        );
        const pending = removeProject(mode, db, w.projectId);
        await blockedBy(billing.pid);
        const usage = await billing.run(
          `INSERT INTO ${t(netTable("mainnet", "soko_bot_usage"))} (id, "updatedAt", "idempotencyKey", "sokoBotId", cents, "transactionId", "userId")
           VALUES ($1::uuid, now(), $5, $2::uuid, 1, $3, $4)`,
          [
            w.id("race.usage"),
            w.id("bot.project"),
            w.id("race.charge"),
            w.id("ada"),
            w.id("race.usage"),
          ],
        );
        await billing.run(usage === "ok" ? "COMMIT" : "ROLLBACK");
        return { cleanUp: await pending, billing: usage };
      },
      "a Soko Bot deletion that holds the bot, then forfeits its bucket":
        async (w: SokoBotDeletionWorld, mode: Mode) => {
          const deletion = await session();
          await deletion.run("BEGIN");
          await deletion.run(
            `SELECT 1 FROM ${t(sharedTable("soko_bot"))} WHERE id = $1::uuid FOR UPDATE`,
            [w.id("bot.project")],
          );
          const pending = removeProject(mode, db, w.projectId);
          await blockedBy(deletion.pid);
          const bucket = await deletion.run(
            `UPDATE ${t(netTable("mainnet", "credit_bucket"))} SET amount = 0 WHERE id = $1`,
            [w.id("bucket.project")],
          );
          await deletion.run(bucket === "ok" ? "COMMIT" : "ROLLBACK");
          return { cleanUp: await pending, deletion: bucket };
        },
    };

    // What origin/main does in each schedule, measured; head must match.
    const onMain: Record<keyof typeof schedules, Record<string, string>> = {
      "an account deletion that deletes the member's pin first": {
        cleanUp: "deleted",
        account: "ok",
      },
      "an account deletion that starts while the clean-up holds the pin": {
        cleanUp: "deleted",
        account: "ok",
        bot: "ok",
      },
      "a Workspace deletion that holds the Workspace and Project first": {
        cleanUp: "gone",
        erasure: "ok",
      },
      "a Workspace deletion that starts while the clean-up holds the Project": {
        cleanUp: "deleted",
        erasure: "ok",
        tasks: "ok",
      },
      "a Project close that holds the Project first": {
        cleanUp: "deleted",
        close: "ok",
      },
      "a Project close that starts while the clean-up holds the Project": {
        cleanUp: "deleted",
        close: "ok",
      },
      "a turn that holds its turn, then asks for its bot": {
        cleanUp: "deadlock",
        turn: "ok",
      },
      "a turn that holds its bot, then writes in the Workspace": {
        cleanUp: "deleted",
        turn: "ok",
      },
      "a turn that asks for its turn and bot while the clean-up waits on a bucket":
        { cleanUp: "deleted", turn: "ok", bot: "deadlock" },
      "billing that records a consumption, then the bot's usage": {
        cleanUp: "deadlock",
        billing: "ok",
      },
      "a Soko Bot deletion that holds the bot, then forfeits its bucket": {
        cleanUp: "deleted",
        deletion: "ok",
      },
    };

    describe.each(Object.keys(schedules) as (keyof typeof schedules)[])(
      "beside %s",
      (name) => {
        it.each(modes)(
          "%s ends as origin/main does",
          async (mode) => {
            const w = await world();
            const ended = await schedules[name](w, mode);
            const kept = Boolean(
              await db.project.findUnique({ where: { id: w.projectId } }),
            );
            expect(kept).toBe(!["deleted", "gone"].includes(ended.cleanUp));
            // PostgreSQL picks the victim of a deadlock by timing; what must
            // match is whether the schedule deadlocks at all.
            const deadlocks = (result: Record<string, unknown>) =>
              Object.values(result).includes("deadlock");
            if (deadlocks(onMain[name])) expect(deadlocks(ended)).toBe(true);
            else expect(ended).toEqual(onMain[name]);
          },
          60_000,
        );
      },
    );
  });
});

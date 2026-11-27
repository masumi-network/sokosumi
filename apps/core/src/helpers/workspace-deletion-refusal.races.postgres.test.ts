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
import { recordedRules, seedJob } from "@/test-fixtures/user-deletion-world";
import {
  newWorkspaceDeletionWorld,
  seedWorkspaceDeletionWorld,
  type WorkspaceDeletionFlow,
  type WorkspaceDeletionWorld,
} from "@/test-fixtures/workspace-deletion-world";

type Tx = Prisma.TransactionClient;
type Client = typeof import("@/lib/db/prisma").default;
type Mode = "base" | "head";

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

/**
 * `base` is the code before #8489: Core checks nothing and the keys refuse
 * at the delete. `head` runs Core's refusals.
 */
const core = vi.hoisted(() => ({
  appliesTheRules: true,
  counts: {} as Record<string, number>,
  /** Runs once, right after the deletion reads its candidate Soko Bots. */
  afterBotRead: undefined as (() => Promise<void>) | undefined,
  /** Runs once, at the start of the deletion's transaction. */
  atStart: undefined as (() => Promise<void>) | undefined,
  wrap: ((tx: Tx) => tx) as (tx: Tx) => Tx | Promise<Tx>,
}));

vi.mock("./workspace-deletion-crossing-rules", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./workspace-deletion-crossing-rules")
    >();
  return {
    ...actual,
    ...recordedRules(
      {
        applyOrganizationRules: actual.applyOrganizationRules,
        checkWorkspaceDeletion: actual.checkWorkspaceDeletion,
        refuseJobsInWorkspace: actual.refuseJobsInWorkspace,
      },
      core,
    ),
  };
});
vi.mock("./user-deletion-crossing-rules", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./user-deletion-crossing-rules")>();
  return {
    ...actual,
    ...recordedRules(
      { applyRulesAfterDelete: actual.applyRulesAfterDelete },
      core,
    ),
    workspaceBotIds: async (
      ...args: Parameters<typeof actual.workspaceBotIds>
    ) => {
      const ids = await actual.workspaceBotIds(...args);
      const hook = core.afterBotRead;
      core.afterBotRead = undefined;
      await hook?.();
      return ids;
    },
  };
});
vi.mock("@/lib/db/prisma", async (importOriginal) => {
  const db = await importOriginal<typeof import("@/lib/db/prisma")>();
  return {
    ...db,
    default: new Proxy(db.default, {
      get(target, property, receiver) {
        if (property !== "$transaction")
          return Reflect.get(target, property, receiver);
        return (run: (tx: Tx) => Promise<unknown>) =>
          target.$transaction(
            async (tx) => {
              const hook = core.atStart;
              core.atStart = undefined;
              await hook?.();
              return run(await core.wrap(tx));
            },
            { timeout: 30_000 },
          );
      },
    }),
  };
});

const flows = ["organization", "personal workspace"] as const;
const networks: Network[] = onSplitLayout
  ? ["mainnet", "preprod"]
  : ["mainnet"];
const network = "mainnet";
const modes = ["base", "head"] as const;

function outcome(error: {
  code?: string;
  status?: number;
  cause?: { kind?: string };
  body?: { code?: string };
  meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
}) {
  const pg = error.meta?.driverAdapterError?.cause?.originalCode;
  if (error.code === "P2003" || pg === "23503" || pg === "23001")
    return "foreign key";
  return error.body?.code ?? error.cause?.kind ?? error.code ?? error.status;
}

describe.runIf(ON_POSTGRES)(
  "a Soko Bot that moves to another Workspace and hires there",
  () => {
    let db: Client;
    let client: Client;
    let deleteOrganization: typeof import("./organization-deletion").prepareOrganizationForDeletion;
    let deletePersonalWorkspace: typeof import("./personal-workspace").deletePersonalWorkspace;
    const cleanup: WorkspaceDeletionWorld[] = [];

    beforeAll(async () => {
      vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
      ({ default: db } =
        await vi.importActual<typeof import("@/lib/db/prisma")>(
          "@/lib/db/prisma",
        ));
      ({ default: client } = await import("@/lib/db/prisma"));
      ({ prepareOrganizationForDeletion: deleteOrganization } = await import(
        "./organization-deletion"
      ));
      ({ deletePersonalWorkspace } = await import("./personal-workspace"));
    }, 60_000);

    afterEach(async () => {
      for (const { id } of cleanup.splice(0)) {
        for (const local of networks) {
          await db.$executeRaw`DELETE FROM ${netTable(local, "Job")} WHERE "agentId" = ${id("agent")}`;
          await db.$executeRaw`DELETE FROM ${netTable(local, "task_x402_payment")} WHERE "agentId" = ${id("agent")}`;
          await db.$executeRaw`DELETE FROM ${netTable(local, "task_payment_claim")} WHERE id = ${id("claim")}`;
          await db.$executeRaw`DELETE FROM ${netTable(local, "Transaction")} WHERE "userId" = ANY(${[id("ada"), id("bob")]})`;
          await db.$executeRaw`DELETE FROM ${netTable(local, "Agent")} WHERE id = ${id("agent")}`;
          await db.$executeRaw`DELETE FROM ${netTable(local, "AgentPricing")} WHERE id = ${id("agent")}`;
        }
        await db.task.deleteMany({
          where: {
            workspaceId: {
              in: [
                id("org.workspace"),
                id("otherOrg.workspace"),
                id("ada.workspace"),
                id("bob.workspace"),
              ],
            },
          },
        });
        await db.organization.deleteMany({
          where: { id: { in: [id("org"), id("otherOrg")] } },
        });
        await db.user.deleteMany({
          where: { id: { in: [id("ada"), id("bob")] } },
        });
        await db.coworker.deleteMany({ where: { id: id("coworker") } });
        await db.vendor.deleteMany({ where: { id: id("vendor") } });
      }
      // With the keys in place, none of Core's statements changes a row.
      expect(
        Object.entries(core.counts).filter(([, count]) => count !== 0),
      ).toEqual([]);
      core.counts = {};
      core.afterBotRead = undefined;
      core.atStart = undefined;
      core.wrap = (tx) => tx;
    }, 60_000);

    afterAll(() => vi.unstubAllEnvs());

    async function worldFor(flow: WorkspaceDeletionFlow) {
      const world = newWorkspaceDeletionWorld(flow);
      await db.$transaction(
        (tx) => seedWorkspaceDeletionWorld(tx, flow, networks, world),
        { timeout: 30_000 },
      );
      cleanup.push(world);
      return world;
    }

    function remove(
      mode: Mode,
      flow: WorkspaceDeletionFlow,
      world: WorkspaceDeletionWorld,
    ) {
      core.appliesTheRules = mode === "head";
      return (
        flow === "organization"
          ? deleteOrganization(world.organizationId, world.actorId, client)
          : deletePersonalWorkspace(world.actorId)
      ).then(() => "deleted", outcome);
    }

    /** Moves `bot.workspace` into the other Organization and hires a Job there. */
    function moveThenHire({ id }: WorkspaceDeletionWorld) {
      return db.$transaction(async (tx) => {
        const moved = await tx.$executeRaw`
          UPDATE ${sharedTable("soko_bot")}
          SET "workspaceId" = ${id("otherOrg.workspace")}::uuid,
              "projectId" = ${id("otherProject")}::uuid
          WHERE id = ${id("bot.workspace")}::uuid
        `;
        if (moved === 0) return "bot gone";
        await seedJob(tx, network, {
          id: id("job.moved"),
          agentId: id("agent"),
          workspaceId: id("otherOrg.workspace"),
          projectId: id("otherProject"),
          creatorSokoBotId: id("bot.workspace"),
        });
        return "moved and hired";
      });
    }

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

    async function movedRows({ id }: WorkspaceDeletionWorld) {
      const [rows] = await db.$queryRaw<
        { bot: string | null; job: string | null }[]
      >`
        SELECT
          (SELECT "workspaceId"::text FROM ${sharedTable("soko_bot")} WHERE id = ${id("bot.workspace")}::uuid) AS bot,
          (SELECT "creatorSokoBotId"::text FROM ${netTable(network, "Job")} WHERE id = ${id("job.moved")}) AS job
      `;
      return rows;
    }

    describe.each(flows)("%s deletion", (flow) => {
      it.each(modes)(
        "deletes, keeping the moved bot and its Job, when they commit between the deletion's reads (%s)",
        async (mode) => {
          const world = await worldFor(flow);
          let writer: unknown;
          const write = async () => {
            writer = await moveThenHire(world);
          };
          // Head reads the candidate bots, then checks; base reads nothing,
          // so the writer commits before its delete.
          if (mode === "head") core.afterBotRead = write;
          else core.atStart = write;
          expect(await remove(mode, flow, world)).toBe("deleted");
          expect(writer).toBe("moved and hired");
          expect(await movedRows(world)).toEqual({
            bot: world.id("otherOrg.workspace"),
            job: world.id("bot.workspace"),
          });
        },
        60_000,
      );

      it.each(modes)(
        "takes the bot first when the deletion commits before the move (%s)",
        async (mode) => {
          const world = await worldFor(flow);
          let writer: Promise<unknown> | undefined;
          core.wrap = (tx) =>
            new Proxy(tx, {
              get(target, property, receiver) {
                const model =
                  flow === "organization" ? "organization" : "workspace";
                const method =
                  flow === "organization" ? "deleteMany" : "delete";
                if (property !== model)
                  return Reflect.get(target, property, receiver);
                return new Proxy(target[model], {
                  get(delegate, name, inner) {
                    const call = Reflect.get(delegate, name, inner);
                    if (name !== method) return call;
                    return async (...args: unknown[]) => {
                      const result = await Reflect.apply(call, delegate, args);
                      if (!writer) {
                        writer = moveThenHire(world);
                        // The move waits on the bot row the cascade deleted.
                        await waitForAnyLock();
                      }
                      return result;
                    };
                  },
                });
              },
            });
          expect(await remove(mode, flow, world)).toBe("deleted");
          expect(await writer).toBe("bot gone");
          expect(await movedRows(world)).toEqual({ bot: null, job: null });
        },
        60_000,
      );
    });
  },
);

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
  recordedRules,
  seedJob,
} from "@/test-fixtures/user-deletion-world";
import {
  DELETION_FIXTURE_TIME,
  newWorkspaceDeletionWorld,
  seedWorkspaceDeletionWorld,
  type WorkspaceDeletionFlow,
  type WorkspaceDeletionWorld,
} from "@/test-fixtures/workspace-deletion-world";

type Tx = Prisma.TransactionClient;
type Client = typeof import("@/lib/db/prisma").default;
type Write = (tx: Tx) => Promise<unknown>;
type DeleteHook = (tx: Tx) => Tx | Promise<Tx>;

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

const core = vi.hoisted(() => ({
  appliesTheRules: true,
  counts: {} as Record<string, number>,
  wrap: ((tx: Tx) => tx) as DeleteHook,
}));

vi.mock("./workspace-deletion-crossing-rules", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./workspace-deletion-crossing-rules")
    >();
  return {
    ...actual,
    ...recordedRules(
      { applyOrganizationRules: actual.applyOrganizationRules },
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
          target.$transaction(async (tx) => run(await core.wrap(tx)), {
            timeout: 30_000,
          });
      },
    }),
  };
});

const flows = ["organization", "personal workspace"] as const;
const networks: Network[] = onSplitLayout
  ? ["mainnet", "preprod"]
  : ["mainnet"];
const network = "mainnet";

function aroundDelete(
  model: "task" | "workspace" | "organization",
  method: "delete" | "deleteMany",
  phase: "before" | "after",
  run: () => Promise<void>,
): DeleteHook {
  return (tx) =>
    new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== model) return Reflect.get(target, property, receiver);
        return new Proxy(target[model], {
          get(delegate, property, receiver) {
            const call = Reflect.get(delegate, property, receiver);
            if (property !== method) return call;
            return async (...args: unknown[]) => {
              if (phase === "before") await run();
              const result = await Reflect.apply(call, delegate, args);
              if (phase === "after") await run();
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
  "workspace deletion with a concurrent writer",
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
      expect(
        Object.entries(core.counts).filter(([, count]) => count !== 0),
      ).toEqual([]);
      core.counts = {};
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
      flow: WorkspaceDeletionFlow,
      world: WorkspaceDeletionWorld,
      wrap: DeleteHook = (tx) => tx,
    ) {
      core.wrap = wrap;
      return (
        flow === "organization"
          ? deleteOrganization(world.organizationId, world.actorId, client)
          : deletePersonalWorkspace(world.actorId)
      ).then(() => "deleted", outcome);
    }

    async function exists({ workspaceId }: WorkspaceDeletionWorld) {
      return Boolean(
        await db.workspace.findUnique({ where: { id: workspaceId } }),
      );
    }

    function beforePersonalLock(run: () => Promise<void>): DeleteHook {
      return (tx) =>
        new Proxy(tx, {
          get(target, property, receiver) {
            if (property !== "user")
              return Reflect.get(target, property, receiver);
            return {
              ...target.user,
              findUnique: async (
                ...args: Parameters<Tx["user"]["findUnique"]>
              ) => {
                await run();
                return target.user.findUnique(...args);
              },
            };
          },
        });
    }

    async function waitForLock(pid: number) {
      for (let attempts = 0; attempts < 200; attempts++) {
        const [{ waiting }] = await db.$queryRaw<{ waiting: boolean }[]>`
        SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS waiting
      `;
        if (waiting) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Expected a wait on the other PostgreSQL connection");
    }

    async function deletionFirst(
      flow: WorkspaceDeletionFlow,
      world: WorkspaceDeletionWorld,
      write: Write,
      options: { taskParent?: boolean } = {},
    ) {
      let writer: Promise<unknown> | undefined;
      const startWriter = async () => {
        const started = Promise.withResolvers<number>();
        writer = db
          .$transaction(
            async (tx) => {
              const [{ pid }] = await tx.$queryRaw<
                { pid: number }[]
              >`SELECT pg_backend_pid() AS pid`;
              started.resolve(pid);
              return write(tx);
            },
            { timeout: 10_000 },
          )
          .then((value) => value ?? "written", outcome);
        await waitForLock(await started.promise);
      };
      const hook = options.taskParent
        ? aroundDelete("task", "deleteMany", "after", startWriter)
        : flow === "organization"
          ? aroundDelete("organization", "deleteMany", "after", startWriter)
          : aroundDelete("workspace", "delete", "after", startWriter);
      const deleted = await remove(flow, world, hook);
      return { deleted, writer: await writer };
    }

    async function writerFirst(
      flow: WorkspaceDeletionFlow,
      world: WorkspaceDeletionWorld,
      write: Write,
    ) {
      const started = Promise.withResolvers<void>();
      const commit = Promise.withResolvers<void>();
      const writing = db.$transaction(
        async (tx) => {
          await write(tx);
          started.resolve();
          await commit.promise;
        },
        { timeout: 10_000 },
      );
      const ready = await Promise.race([
        started.promise.then(() => true),
        writing.then(() => false),
      ]);
      expect(ready).toBe(true);
      const deletionPid = Promise.withResolvers<number>();
      const deleting = remove(flow, world, async (tx) => {
        const [{ pid }] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        deletionPid.resolve(pid);
        return tx;
      });
      try {
        await waitForLock(await deletionPid.promise);
      } finally {
        commit.resolve();
        await writing;
      }
      return deleting;
    }

    function seedWorkJob(tx: Tx, world: WorkspaceDeletionWorld) {
      return seedJob(tx, network, {
        id: world.id("job.race"),
        agentId: world.id("agent"),
        workspaceId: world.workspaceId,
      });
    }

    describe.each(flows)("%s", (flow) => {
      const blocked =
        flow === "organization"
          ? "ORGANIZATION_DELETION_WORKSPACE_HAS_JOB"
          : "workspace_has_dependents";

      it("deletes when a Job moves out before the Workspace refusal", async () => {
        const world = await worldFor(flow);
        await db.$transaction((tx) => seedWorkJob(tx, world));
        const move = async () => {
          expect(
            await db.$executeRaw`
          UPDATE ${netTable(network, "Job")} SET "workspaceId" = ${world.id("otherOrg.workspace")}::uuid
          WHERE id = ${world.id("job.race")}
        `,
          ).toBe(1);
        };
        const hook =
          flow === "organization"
            ? aroundDelete("task", "deleteMany", "before", move)
            : beforePersonalLock(move);
        expect(await remove(flow, world, hook)).toBe("deleted");
        expect(await exists(world)).toBe(false);
        expect(
          await db.$queryRaw`
        SELECT "workspaceId" FROM ${netTable(network, "Job")} WHERE id = ${world.id("job.race")}
      `,
        ).toEqual([{ workspaceId: world.id("otherOrg.workspace") }]);
      }, 60_000);

      it("refuses while the Job still lives there, before its mover commits", async () => {
        const world = await worldFor(flow);
        await db.$transaction((tx) => seedWorkJob(tx, world));
        const writing = Promise.withResolvers<void>();
        let moved: Promise<number> | undefined;
        const hook: DeleteHook = (tx) => {
          moved = db.$transaction(
            async (writer) => {
              await writing.promise;
              return writer.$executeRaw`
            UPDATE ${netTable(network, "Job")} SET "workspaceId" = ${world.id("otherOrg.workspace")}::uuid
            WHERE id = ${world.id("job.race")}
          `;
            },
            { timeout: 10_000 },
          );
          return tx;
        };
        try {
          expect(await remove(flow, world, hook)).toBe(blocked);
        } finally {
          writing.resolve();
          expect(await moved).toBe(1);
        }
        expect(await exists(world)).toBe(true);
      }, 60_000);

      it("refuses a Job whose creator commits first", async () => {
        const world = await worldFor(flow);
        expect(
          await writerFirst(flow, world, (tx) => seedWorkJob(tx, world)),
        ).toBe(blocked);
        expect(await exists(world)).toBe(true);
      }, 60_000);

      it("the old Workspace key refuses the Job insert when deletion commits first", async () => {
        const world = await worldFor(flow);
        expect(
          await deletionFirst(flow, world, (tx) => seedWorkJob(tx, world)),
        ).toEqual({
          deleted: "deleted",
          writer: "foreign key",
        });
        expect(await exists(world)).toBe(false);
      }, 60_000);
    });

    it("keeps the moved Project's credit when it leaves after the candidate read", async () => {
      const world = await worldFor("personal workspace");
      const move = async () => {
        expect(
          await db.$executeRaw`
        UPDATE ${sharedTable("project")} SET "workspaceId" = ${world.id("otherOrg.workspace")}::uuid
        WHERE id = ${world.id("project")}::uuid
      `,
        ).toBe(1);
      };
      expect(
        await remove(
          "personal workspace",
          world,
          aroundDelete("workspace", "delete", "before", move),
        ),
      ).toBe("deleted");
      expect(
        await db.$queryRaw`
      SELECT "projectId" FROM ${netTable(network, "credit_bucket")}
      WHERE id = ${world.id("bucket.project")}
    `,
      ).toEqual([{ projectId: world.id("project") }]);
    }, 60_000);

    it("removes the Project and its bucket if the Workspace deletion commits first", async () => {
      const world = await worldFor("personal workspace");
      expect(
        await deletionFirst(
          "personal workspace",
          world,
          (tx) => tx.$executeRaw`
      UPDATE ${sharedTable("project")} SET "workspaceId" = ${world.id("otherOrg.workspace")}::uuid
      WHERE id = ${world.id("project")}::uuid
    `,
        ),
      ).toEqual({ deleted: "deleted", writer: 0 });
      expect(
        await db.project.findUnique({ where: { id: world.id("project") } }),
      ).toBeNull();
      expect(
        await db.$queryRaw`
      SELECT id FROM ${netTable(network, "credit_bucket")} WHERE id = ${world.id("bucket.project")}
    `,
      ).toEqual([]);
    }, 60_000);

    function addMember(tx: Tx, world: WorkspaceDeletionWorld) {
      return insertRow(tx, sharedTable("member"), {
        id: world.id("secondMember"),
        userId: world.id("bob"),
        organizationId: world.organizationId,
        role: "member",
      });
    }

    it("refuses an additional member whose insert commits first", async () => {
      const world = await worldFor("organization");
      expect(
        await writerFirst("organization", world, (tx) => addMember(tx, world)),
      ).toBe("ORGANIZATION_HAS_ADDITIONAL_MEMBERS");
      expect(await exists(world)).toBe(true);
    }, 60_000);

    it("the old Organization key refuses the member insert when deletion commits first", async () => {
      const world = await worldFor("organization");
      expect(
        await deletionFirst("organization", world, (tx) =>
          addMember(tx, world),
        ),
      ).toEqual({
        deleted: "deleted",
        writer: "foreign key",
      });
      expect(await exists(world)).toBe(false);
    }, 60_000);

    it("deletes after an additional member's removal commits", async () => {
      const world = await worldFor("organization");
      await db.$transaction((tx) => addMember(tx, world));
      expect(
        await remove("organization", world, async (tx) => {
          await db.member.delete({ where: { id: world.id("secondMember") } });
          return tx;
        }),
      ).toBe("deleted");
      expect(await exists(world)).toBe(false);
    }, 60_000);

    const preflightWriters = [
      {
        name: "Agent Job Event",
        blocked: "IN_FLIGHT_JOB",
        write: (tx: Tx, { id }: WorkspaceDeletionWorld) => tx.$executeRaw`
          UPDATE ${netTable(network, "jobEvent")} SET status = 'RUNNING'
          WHERE id = ${id("job.org.event")}
        `,
      },
      {
        name: "on-chain Job purchase",
        blocked: "UNSETTLED_ON_CHAIN_JOB",
        write: (tx: Tx, { id }: WorkspaceDeletionWorld) =>
          insertRow(tx, netTable(network, "jobPurchase"), {
            id: id("job.org.purchase"),
            jobId: id("job.org"),
            externalId: id("job.org.purchase"),
            updatedAt: DELETION_FIXTURE_TIME,
          }),
      },
    ];
    describe.each(preflightWriters)("$name", ({ blocked, write }) => {
      it("blocks when the writer commits before the Organization's preflight", async () => {
        const world = await worldFor("organization");
        expect(
          await remove("organization", world, async (tx) => {
            await db.$transaction(async (writer) => {
              await write(writer, world);
            });
            return tx;
          }),
        ).toBe(blocked);
        expect(await exists(world)).toBe(true);
      }, 60_000);

      it("keeps the base decision when the writer commits after preflight", async () => {
        const world = await worldFor("organization");
        const change = async () => {
          await db.$transaction(async (tx) => {
            await write(tx, world);
          });
        };
        expect(
          await remove(
            "organization",
            world,
            aroundDelete("task", "deleteMany", "before", change),
          ),
        ).toBe("deleted");
        expect(await exists(world)).toBe(false);
      }, 60_000);
    });

    async function subtaskWorld() {
      const world = await worldFor("organization");
      const { id } = world;
      await db.$transaction(async (tx) => {
        // Reproduce a legacy cross-workspace link. The grandchild's immediate
        // parent and workspace differ from the one the organization locks.
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.task.create({
          data: {
            id: id("branch"),
            name: "Branch in the other workspace",
            workspaceId: id("otherOrg.workspace"),
            organizationId: id("otherOrg"),
            ownerId: id("bob"),
            parentTaskId: id("task"),
            position: 1,
          },
        });
        await tx.$executeRaw`SET LOCAL session_replication_role = origin`;
        await tx.task.create({
          data: {
            id: id("leaf"),
            name: "Leaf in the other workspace",
            workspaceId: id("otherOrg.workspace"),
            organizationId: id("otherOrg"),
            ownerId: id("bob"),
            parentTaskId: id("branch"),
            position: 1,
          },
        });
        await tx.$executeRaw`
        UPDATE ${netTable(network, "Job")} SET "taskId" = ${id("leaf")} WHERE id = ${id("job.other")}
      `;
      });
      return world;
    }

    async function detach(tx: Tx, world: WorkspaceDeletionWorld) {
      const { moveTask } = await import("./task-subtask-move");
      await moveTask(
        tx,
        { source: "session", userId: world.id("bob") } as never,
        {
          taskId: world.id("leaf"),
          parentTaskId: null,
        },
      );
    }

    it("keeps the detached grandchild and its Job link when the mover commits first", async () => {
      const world = await subtaskWorld();
      const move = () =>
        db.$transaction((tx) => detach(tx, world), {
          isolationLevel: "Serializable",
        });
      expect(
        await remove(
          "organization",
          world,
          aroundDelete("task", "deleteMany", "before", move),
        ),
      ).toBe("deleted");
      expect(
        await db.task.findUnique({ where: { id: world.id("leaf") } }),
      ).toMatchObject({ parentTaskId: null });
      expect(
        await db.$queryRaw`
      SELECT "taskId" FROM ${netTable(network, "Job")} WHERE id = ${world.id("job.other")}
    `,
      ).toEqual([{ taskId: world.id("leaf") }]);
    }, 60_000);

    it("clears the Job link if the Organization loses the grandchild before the mover", async () => {
      const world = await subtaskWorld();
      expect(
        await deletionFirst("organization", world, (tx) => detach(tx, world), {
          taskParent: true,
        }),
      ).toEqual({
        deleted: "deleted",
        writer: 409,
      });
      expect(
        await db.task.findUnique({ where: { id: world.id("leaf") } }),
      ).toBeNull();
      expect(
        await db.$queryRaw`
      SELECT "taskId" FROM ${netTable(network, "Job")} WHERE id = ${world.id("job.other")}
    `,
      ).toEqual([{ taskId: null }]);
    }, 60_000);
  },
);

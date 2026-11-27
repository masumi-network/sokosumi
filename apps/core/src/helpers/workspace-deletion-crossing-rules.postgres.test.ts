import * as Sentry from "@sentry/node";
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

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

type Tx = Prisma.TransactionClient;

const core = vi.hoisted(() => ({
  appliesTheRules: true,
  counts: {} as Record<string, number>,
  tx: undefined as Tx | undefined,
}));

vi.mock("./workspace-deletion-crossing-rules", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./workspace-deletion-crossing-rules")
    >();
  return {
    ...recordedRules(
      {
        applyOrganizationRules: actual.applyOrganizationRules,
        checkWorkspaceDeletion: actual.checkWorkspaceDeletion,
        refuseJobsInWorkspace: actual.refuseJobsInWorkspace,
      },
      core,
    ),
    workspaceHasDependents: actual.workspaceHasDependents,
    refuseOrganizationWorkspaceDeletion:
      actual.refuseOrganizationWorkspaceDeletion,
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
    default: {
      ...db.default,
      $transaction: (run: (tx: Tx) => Promise<unknown>) => {
        if (!core.tx) throw new Error("Expected the test transaction");
        return run(core.tx);
      },
    },
  };
});

const flows = ["organization", "personal workspace"] as const;
const networks: Network[] = onSplitLayout
  ? ["mainnet", "preprod"]
  : ["mainnet"];

function dropOwnedCrossingKeys(tx: Tx, flow: WorkspaceDeletionFlow) {
  return dropFlowCrossingKeys(tx, flow, networks);
}

async function expectSurvivors(
  tx: Tx,
  world: WorkspaceDeletionWorld,
  flow: WorkspaceDeletionFlow,
) {
  const { id } = world;
  const [survivors] = await tx.$queryRaw<
    { workspaces: string[]; users: string[]; orgs: string[] }[]
  >`
    SELECT
      ARRAY(SELECT workspace.id::text FROM ${sharedTable("workspace")} AS workspace
        WHERE workspace.id = ANY(${[world.workspaceId, id("otherOrg.workspace"), id("bob.workspace")]}::uuid[])
        ORDER BY workspace.id) AS workspaces,
      ARRAY(SELECT person.id FROM ${sharedTable("user")} AS person
        WHERE person.id = ANY(${[id("ada"), id("bob")]}) ORDER BY person.id) AS users,
      ARRAY(SELECT org.id FROM ${sharedTable("organization")} AS org
        WHERE org.id = ANY(${[world.organizationId, id("otherOrg")]}) ORDER BY org.id) AS orgs
  `;
  expect(survivors).toEqual({
    workspaces: [id("otherOrg.workspace"), id("bob.workspace")].sort(),
    users: [id("ada"), id("bob")].sort(),
    orgs: (flow === "organization"
      ? [id("otherOrg")]
      : [world.organizationId, id("otherOrg")]
    ).sort(),
  });
  for (const network of networks) {
    const [rows] = await tx.$queryRaw<
      {
        bucket: boolean;
        orgBucket: boolean;
        usage: boolean;
        charge: boolean;
        job: boolean;
        twinOrg: string | null;
      }[]
    >`
      SELECT
        EXISTS (SELECT 1 FROM ${netTable(network, "credit_bucket")}
          WHERE id = ${id("bucket.other")} AND "projectId" = ${id("otherProject")}::uuid) AS bucket,
        EXISTS (SELECT 1 FROM ${netTable(network, "credit_bucket")}
          WHERE id = ${id("bucket.otherOrg")} AND "organizationId" = ${id("otherOrg")}) AS "orgBucket",
        EXISTS (SELECT 1 FROM ${netTable(network, "soko_bot_usage")}
          WHERE id = ${id("usage.other")} AND "sokoBotId" = ${id("bot.other")}::uuid
            AND "organizationId" = ${id("otherOrg")}) AS usage,
        EXISTS (SELECT 1 FROM ${netTable(network, "Transaction")}
          WHERE id = ${id("charge.other")} AND "userId" = ${id("bob")}
            AND "organizationId" = ${id("otherOrg")}) AS charge,
        EXISTS (SELECT 1 FROM ${netTable(network, "Job")}
          WHERE id = ${id("job.other")} AND "workspaceId" = ${id("otherOrg.workspace")}::uuid
            AND "projectId" = ${id("otherProject")}::uuid AND "taskId" = ${id("otherTask")}
            AND "creatorSokoBotId" = ${id("bot.other")}::uuid) AS job,
        (SELECT "organizationId" FROM ${netTable(network, "Job")}
          WHERE id = ${id("job.twin")}) AS "twinOrg"
    `;
    expect(rows).toEqual({
      bucket: true,
      orgBucket: true,
      usage: true,
      charge: true,
      job: true,
      twinOrg:
        network === "preprod"
          ? id("otherOrg")
          : flow === "organization"
            ? null
            : world.organizationId,
    });
  }
}

describe.runIf(ON_POSTGRES)("workspace deletion and crossing keys", () => {
  let prisma: typeof import("@/lib/db/prisma").default;
  let deletePersonalWorkspace: typeof import("./personal-workspace").deletePersonalWorkspace;
  let deleteOrganization: typeof import("./organization-deletion").prepareOrganizationForDeletion;
  let countOrphans: typeof import("@/lib/db/crossing-key-orphans").countCrossingKeyOrphans;
  let pauseKey: string;

  beforeAll(async () => {
    vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
    ({ default: prisma } =
      await vi.importActual<typeof import("@/lib/db/prisma")>(
        "@/lib/db/prisma",
      ));
    ({ deletePersonalWorkspace } = await import("./personal-workspace"));
    ({ prepareOrganizationForDeletion: deleteOrganization } = await import(
      "./organization-deletion"
    ));
    ({ countCrossingKeyOrphans: countOrphans } = await import(
      "@/lib/db/crossing-key-orphans"
    ));
    ({ PREPROD_PAUSE_KEY: pauseKey } = await import(
      "@/helpers/preprod-control"
    ));
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-02-01") });
  }, 60_000);

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  // Needs its own PostgreSQL database. Both dropping keys and comparing every
  // table are isolated by CI's POSTGRES_TEST_DATABASE_PER_WORKER option.
  async function inWorld(
    flow: WorkspaceDeletionFlow,
    run: (tx: Tx, world: WorkspaceDeletionWorld) => Promise<void>,
    preprod: "off" | "paused" | "open" = "paused",
  ) {
    const rollback = new Error("roll back test world");
    try {
      await prisma.$transaction(
        async (tx) => {
          const world = newWorkspaceDeletionWorld(flow);
          await seedWorkspaceDeletionWorld(tx, flow, networks, world);
          if (preprod === "open") {
            await insertRow(tx, sharedTable("sync_metadata"), {
              id: world.id("preprodState"),
              key: pauseKey,
              cursorId: "open",
              lastSyncedAt: DELETION_FIXTURE_TIME,
              updatedAt: DELETION_FIXTURE_TIME,
            });
          }
          expect(
            await tx.syncMetadata.findUnique({
              where: { key: pauseKey },
              select: { cursorId: true },
            }),
          ).toEqual(preprod === "open" ? { cursorId: "open" } : null);
          await tx.$executeRaw`SAVEPOINT before_deletion`;
          await run(tx, world);
          throw rollback;
        },
        { timeout: 120_000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  function remove(
    tx: Tx,
    world: WorkspaceDeletionWorld,
    flow: WorkspaceDeletionFlow,
    rules: boolean,
  ) {
    core.appliesTheRules = rules;
    core.counts = {};
    core.tx = tx;
    return flow === "organization"
      ? deleteOrganization(world.organizationId, world.actorId, {
          $transaction: (run: (tx: Tx) => Promise<unknown>) => run(tx),
        } as never)
      : deletePersonalWorkspace(world.actorId);
  }

  it("keeps the legacy personal Workspace refusal for a Task after the crossing keys are dropped", async () => {
    await inWorld("personal workspace", async (tx, world) => {
      await dropOwnedCrossingKeys(tx, "personal workspace");
      await tx.task.create({
        data: { name: "Remaining Task", workspaceId: world.workspaceId },
      });
      expect(
        await remove(tx, world, "personal workspace", true).then(
          () => "deleted",
          refusal,
        ),
      ).toBe("workspace_has_dependents");
    });
  }, 120_000);

  describe.each(flows)("%s", (flow) => {
    it.each(onSplitLayout ? (["paused", "open"] as const) : (["off"] as const))(
      "matches the legacy end state with keys and without keys when Preprod is %s",
      async (preprod) => {
        await inWorld(
          flow,
          async (tx, world) => {
            const seeded = await digests(tx);
            await remove(tx, world, flow, false);
            const base = await digests(tx);
            expect(base).not.toEqual(seeded);
            await expectSurvivors(tx, world, flow);
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT before_deletion`;

            await remove(tx, world, flow, true);
            const affectedBesideTheKeys = { ...core.counts };
            expect(
              Object.values(affectedBesideTheKeys).filter(Boolean),
            ).toEqual([]);
            expect(await digests(tx)).toEqual(base);
            expect(
              (await countOrphans(tx)).filter(({ count }) => count > 0n),
            ).toEqual([]);
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT before_deletion`;

            await dropOwnedCrossingKeys(tx, flow);
            await remove(tx, world, flow, true);
            expect(
              Object.entries(core.counts).filter(([, count]) => count === 0),
            ).toEqual([]);
            expect(Object.keys(core.counts).sort()).toEqual(
              keysFor(flow)
                .filter(([, , , action]) => action !== "Restrict")
                .map(([table, column]) => `${table}.${column}`)
                .sort(),
            );
            expect(Object.keys(affectedBesideTheKeys).sort()).toEqual(
              Object.keys(core.counts).sort(),
            );
            await expectSurvivors(tx, world, flow);
            expect(await digests(tx)).toEqual(base);
            expect(
              (await countOrphans(tx)).filter(({ count }) => count > 0n),
            ).toEqual([]);
          },
          preprod,
        );
      },
      120_000,
    );

    for (const network of networks) {
      const cases = [
        ["workspaceJob", "ORGANIZATION_DELETION_WORKSPACE_HAS_JOB"],
        ["hiredJob", "ORGANIZATION_DELETION_SOKO_BOT_HIRED_JOB"],
        ...(flow === "organization"
          ? [["subtaskPayment", "ORGANIZATION_DELETION_SUBTASK_HAS_PAYMENT"]]
          : []),
      ];
      it.each(cases)(
        "refuses %s on " + network + " after its FK is dropped",
        async (blocker, code) => {
          await inWorld(flow, async (tx, world) => {
            const { id } = world;
            const seed = async () => {
              if (blocker === "subtaskPayment") {
                for (const local of networks) {
                  if (local !== network) {
                    await tx.$executeRaw`
                      DELETE FROM ${netTable(local, "task_x402_payment")}
                      WHERE id = ${id("payment.other")}
                    `;
                  }
                }
                // Retain all FK constraints for the oracle. Bypass the current
                // placement trigger to reproduce the legacy cross-workspace tree.
                await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
                await tx.task.update({
                  where: { id: id("otherTask") },
                  data: { parentTaskId: id("task"), position: 1 },
                });
                await tx.$executeRaw`SET LOCAL session_replication_role = origin`;
                return;
              }
              await seedJob(tx, network, {
                id: id("job.blocker"),
                agentId: id("agent"),
                workspaceId:
                  blocker === "workspaceJob"
                    ? world.workspaceId
                    : id("otherOrg.workspace"),
                creatorSokoBotId:
                  blocker === "hiredJob" ? id("bot.project") : null,
                organizationId:
                  flow === "organization" ? world.organizationId : null,
              });
              await insertRow(tx, netTable(network, "jobEvent"), {
                id: id("job.blocker.event"),
                jobId: id("job.blocker"),
                status: "COMPLETED",
                updatedAt: DELETION_FIXTURE_TIME,
              });
            };
            const expected =
              flow === "organization" ? code : "workspace_has_dependents";
            await seed();
            expect(
              await remove(tx, world, flow, false).then(
                () => "deleted",
                refusal,
              ),
            ).toBe(flow === "organization" ? "foreign key" : expected);
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT before_deletion`;
            await seed();
            vi.mocked(Sentry.captureMessage).mockClear();
            expect(
              await remove(tx, world, flow, true).then(
                () => "deleted",
                refusal,
              ),
            ).toBe(expected);
            if (flow === "organization") {
              expect(Sentry.captureMessage).toHaveBeenCalledWith(
                "Organization deletion refused by a Network row",
                expect.objectContaining({
                  level: "error",
                  extra: expect.objectContaining({
                    code,
                    network,
                    workspaceId: world.workspaceId,
                    organizationId: world.organizationId,
                    blockerId: expect.any(String),
                  }),
                }),
              );
            }
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT before_deletion`;
            await dropOwnedCrossingKeys(tx, flow);
            await seed();
            expect(
              await remove(tx, world, flow, true).then(
                () => "deleted",
                refusal,
              ),
            ).toBe(expected);
          });
        },
        120_000,
      );
    }
  });
});

import { readFileSync } from "node:fs";
import { createPrismaClient } from "@sokosumi/database/client";
import { getUrlBasename } from "@sokosumi/utils";
import { Hono } from "hono";
import type { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import { blobStore, uploads } from "@/test/source-import-blob-store";
import {
  holdCommit,
  inFlow,
  observePool,
  observing,
} from "@/test/spend-comparison";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const state = vi.hoisted(() => ({
  pools: [] as Pool[],
  pending: [] as Promise<unknown>[],
  on: false,
  token: "test-storage",
  deployment: "Mainnet" as "Mainnet" | "Preprod",
  checkIn: vi.fn((..._args: unknown[]) => "check-in"),
  fetch: vi.fn<(url: string) => Promise<Response>>(),
  calls: [] as [string, string][],
}));
vi.mock("@/config/env", async (load) => {
  const actual = await load<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      DATABASE_URL: process.env.DATABASE_URL!,
      NETWORK: state.deployment,
      NETWORK_PREPROD_ENABLED: state.on,
      BLOB_READ_WRITE_TOKEN: state.token,
    }),
  };
});
vi.mock("@sentry/node", async (load) => ({
  ...(await load<typeof import("@sentry/node")>()),
  captureCheckIn: state.checkIn,
}));
vi.mock("@vercel/functions", async (load) => ({
  ...(await load<typeof import("@vercel/functions")>()),
  attachDatabasePool(pool: Pool) {
    // One connection gives concurrent reads a reproducible send order for the
    // public-layout recording. Race tests use the normal pool on split.
    if (!onSplitLayout) pool.options.max = 1;
    state.pools.push(pool);
    observePool(pool);
  },
  waitUntil: (work: Promise<unknown>) => state.pending.push(work),
}));
vi.mock("@sokosumi/utils", async (load) => {
  const actual = await load<typeof import("@sokosumi/utils")>();
  return { ...actual, getUrlBasename: vi.fn(actual.getUrlBasename) };
});
vi.mock("@sokosumi/net", async (load) => ({
  ...(await load<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: state.fetch,
}));
vi.mock("@vercel/blob", async () => ({
  put: async (pathname: string, file: File) => {
    state.calls.push(["put", pathname]);
    return blobStore.put(pathname, file);
  },
  head: async (url: string) => {
    state.calls.push(["head", url]);
    return blobStore.head();
  },
  del: async (url: string) => {
    state.calls.push(["del", url]);
    return blobStore.del(url);
  },
}));

const auth = { headers: { Authorization: "Bearer test-cron-secret" } };
const key = "source-import-sync";
const now = new Date("2026-11-27T12:00:00Z");
type Client = ReturnType<typeof createPrismaClient>;

// Poll on the real clock while the recorded application Date is fixed.
async function until(check: () => boolean | Promise<boolean>) {
  const limit = performance.now() + 3000;
  while (!(await check())) {
    if (performance.now() >= limit) throw new Error("Import gate timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function seedJobs(db: Client, count: number) {
  await db.$transaction(async (tx) => {
    // The importer follows Blob -> JobEvent for the Job id; omit unrelated parents.
    // The two Networks get an actual Job with the same id.
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.job.create({
      data: {
        id: "job",
        agentId: "agent",
        agentJobId: "external-job",
        jobType: "FREE",
        workspaceId: "01970000-0000-7000-8000-000000000001",
      },
    });
    await tx.jobEvent.create({ data: { id: "event", jobId: "job" } });
    for (let i = 1; i <= count; i++) {
      await tx.blob.create({
        data: {
          id: `job-${i}`,
          eventId: "event",
          sourceUrl: `https://source.test/job-${i}.md`,
          status: "PENDING",
          createdAt: new Date(i),
        },
      });
    }
  });
}
async function seedTasks(db: Client, count: number) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.task.create({
      data: {
        id: "task",
        name: "fixture",
        workspaceId: "01970000-0000-7000-8000-000000000001",
      },
    });
    for (let i = 1; i <= count; i++) {
      await tx.taskFile.create({
        data: {
          id: `task-${i}`,
          taskId: "task",
          name: `task-${i}.md`,
          sourceUrl: `https://source.test/task-${i}.md`,
          status: "PENDING",
          origin: "TASK_OUTPUT",
          createdAt: new Date(i),
        },
      });
    }
  });
}

const url = process.env.DATABASE_URL;
describe.skipIf(
  !(
    process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
    url?.startsWith("postgres")
  ),
)("source import cron", () => {
  let app: Hono;
  let db: Awaited<ReturnType<typeof copyPostgresTestDatabase>>;
  let main: Client;
  let shared: Client;
  let preprod: Client;
  let control: typeof import("@/helpers/preprod-control");
  async function run(network: "mainnet" | "preprod" = "mainnet") {
    const path =
      network === "mainnet"
        ? "/sync/source-import"
        : "/sync/preprod/source-import";
    const response = await app.request(path, auth);
    await Promise.all(state.pending.splice(0));
    return [response.status, await response.json()];
  }

  beforeAll(async () => {
    db = await copyPostgresTestDatabase(
      process.env.POSTGRES_TEST_TEMPLATE_URL ?? url!,
      "files_import_test",
    );
    vi.stubEnv("DATABASE_URL", db.url);
    vi.stubEnv("DATABASE_URL_UNPOOLED", db.url);
    state.on = onSplitLayout;
    const router = new Hono();
    (await import("./get")).default(router);
    app = new Hono().route("/sync", router);
    control = await import("@/helpers/preprod-control");
    const names = testSchemaNames();
    main = createPrismaClient(db.url, {
      schema: names.DATABASE_SCHEMA_MAINNET,
    });
    preprod = createPrismaClient(db.url, {
      schema: names.DATABASE_SCHEMA_PREPROD,
    });
    shared = createPrismaClient(db.url, {
      schema: names.DATABASE_SCHEMA_SHARED,
    });
    const [row] = await shared.$queryRaw<
      { db: string }[]
    >`SELECT current_database() AS db`;
    expect(row.db).toBe(db.name);
  }, 60_000);
  beforeEach(async () => {
    state.on = onSplitLayout;
    state.token = "test-storage";
    state.deployment = "Mainnet";
    state.checkIn.mockClear();
    state.calls.length = 0;
    uploads.length = 0;
    state.fetch
      .mockReset()
      .mockImplementation(async () => new Response("file"));
    await shared.lock.deleteMany();
    await shared.syncMetadata.deleteMany();
    await shared.taskFile.deleteMany();
    await shared.task.deleteMany();
    await main.job.deleteMany();
    if (onSplitLayout) await preprod.job.deleteMany();
  });
  afterAll(async () => {
    await Promise.all([
      main.$disconnect(),
      shared.$disconnect(),
      preprod.$disconnect(),
      ...state.pools.map((pool) => pool.end()),
    ]);
    vi.unstubAllEnvs();
    await db.drop();
  }, 60_000);

  it.skipIf(onSplitLayout).each(["Mainnet", "Preprod"] as const)(
    "matches the recorded combined cron on %s",
    async (deployment) => {
      state.deployment = deployment;
      for (const scenario of ["empty", "mixed", "deadline"] as const) {
        await shared.lock.deleteMany();
        state.calls.length = 0;
        state.checkIn.mockClear();
        if (scenario !== "empty") {
          await main.job.deleteMany();
          await shared.task.deleteMany();
          await seedJobs(main, 4);
          await seedTasks(shared, 3);
        }
        const gates = new Map<
          string,
          ReturnType<typeof Promise.withResolvers<void>>
        >();
        let releasing = false;
        state.fetch.mockImplementation(async (url) => {
          if (!releasing) {
            const gate = Promise.withResolvers<void>();
            gates.set(new URL(url).pathname.slice(1), gate);
            await gate.promise;
          }
          return new Response("fixture");
        });
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(now);
        try {
          const { log, outcome } = await observing(async () => {
            const running = run();
            try {
              if (scenario !== "empty") {
                await until(() => gates.size === 5);
                expect([...gates.keys()].sort()).toEqual([
                  "job-1.md",
                  "job-2.md",
                  "job-3.md",
                  "task-1.md",
                  "task-2.md",
                ]);
                const order = [
                  "job-1",
                  "task-1",
                  "job-2",
                  "task-2",
                  "job-3",
                  "task-3",
                  "job-4",
                ];
                for (const [i, id] of order.entries()) {
                  if (scenario === "deadline") {
                    if (i === 0) vi.setSystemTime(now.getTime() + 875_000 - 1);
                    if (i === 1) vi.setSystemTime(now.getTime() + 875_000);
                    if (id === "job-4") break;
                  }
                  const name = `${id}.md`;
                  await until(() => gates.has(name));
                  gates.get(name)!.resolve();
                  await until(async () => {
                    const row = id.startsWith("job")
                      ? await main.blob.findUniqueOrThrow({ where: { id } })
                      : await shared.taskFile.findUniqueOrThrow({
                          where: { id },
                        });
                    return row.status === "READY";
                  });
                  if (i === 0) await until(() => gates.has("task-3.md"));
                  if (i === 1 && scenario === "mixed")
                    await until(() => gates.has("job-4.md"));
                }
              }
            } finally {
              releasing = true;
              for (const gate of gates.values()) gate.resolve();
              await running;
            }
            return running;
          });
          expect(outcome).toEqual([200, { message: "Syncing started" }]);
          const locks = await shared.lock.findMany();
          expect(locks).toHaveLength(1);
          const owner = log[4].values[1];
          expect(owner).toMatch(/^test-instance-id:/);
          const record = {
            outcome,
            sql: log.map(({ text, values }) => ({ text, values })),
            locks,
            cursors: await shared.syncMetadata.findMany(),
            storage: state.calls,
            monitor: state.checkIn.mock.calls,
          };
          const stable = JSON.stringify(record)
            .replaceAll(locks[0].id, "<lock id>")
            .replaceAll(String(owner), "<owner token>");
          expect(JSON.parse(stable)).toEqual(
            JSON.parse(
              readFileSync(
                new URL(`./base-${scenario}.json`, import.meta.url),
                "utf8",
              ),
            ),
          );
        } finally {
          vi.useRealTimers();
        }
      }
    },
    30_000,
  );

  it("skips off and unconfigured Preprod before SQL or storage", async () => {
    for (const reason of ["off", "unconfigured"]) {
      state.on = reason !== "off";
      state.token = "";
      const { log, outcome } = await observing(() => run("preprod"));
      expect(outcome).toEqual([200, { message: "Sync skipped", reason }]);
      expect(log).toEqual([]);
      expect(state.calls).toEqual([]);
      expect(state.checkIn).toHaveBeenLastCalledWith({
        monitorSlug: "preprod-source-import-sync",
        status: "ok",
      });
    }
  });

  const open = () =>
    shared.syncMetadata.create({
      data: {
        key: control.PREPROD_PAUSE_KEY,
        cursorId: "open",
        lastSyncedAt: now,
      },
    });
  const change = (action: "pause" | "raise") =>
    action === "pause"
      ? control.setPreprodPaused({
          paused: true,
          operatorId: "operator",
          reason: "cron fence",
        })
      : control.raisePreprodGeneration();
  describe.runIf(onSplitLayout)("on the split layout", () => {
    it("isolates same-id jobs and leaves the shared files for Mainnet", async () => {
      await seedJobs(preprod, 1);
      await seedJobs(main, 1);
      await seedTasks(shared, 1);
      expect(await run("preprod")).toEqual([
        200,
        { message: "Sync skipped", reason: "paused" },
      ]);
      await open();
      await run("preprod");
      expect((await main.blob.findFirstOrThrow()).status).toBe("PENDING");
      expect((await shared.taskFile.findFirstOrThrow()).status).toBe("PENDING");
      expect((await preprod.blob.findFirstOrThrow()).fileUrl).toBe(
        "https://blob.test/preprod/jobs/job/job-1.md",
      );
      expect(uploads.map((x) => x.pathname)).toEqual([
        "preprod/jobs/job/job-1.md",
      ]);
      expect(state.checkIn).toHaveBeenCalledWith(
        { monitorSlug: "preprod-source-import-sync", status: "in_progress" },
        expect.objectContaining({
          schedule: { type: "crontab", value: "*/5 * * * *" },
        }),
      );
    });
    it("fails rejected filenames, cleans their uploads and imports the sixth blob", async () => {
      await open();
      await seedJobs(preprod, 6);
      const basename = vi.mocked(getUrlBasename);
      await basename.withImplementation(
        (url) => {
          const name = new URL(url).pathname.slice(1);
          return name === "job-6.md" ? name : name + "\0";
        },
        async () => {
          await run("preprod");
        },
      );
      expect(
        await preprod.blob.count({
          where: { status: "FAILED", fileUrl: null },
        }),
      ).toBe(5);
      expect(
        await preprod.blob.findUniqueOrThrow({ where: { id: "job-6" } }),
      ).toMatchObject({
        status: "READY",
        fileUrl: "https://blob.test/preprod/jobs/job/job-6.md",
      });
      expect(uploads.map((upload) => upload.pathname)).toEqual([
        "preprod/jobs/job/job-6.md",
      ]);
      expect(state.calls.filter(([method]) => method === "del")).toHaveLength(
        5,
      );
      const calls = state.calls.length;
      await run("preprod");
      expect(state.calls).toHaveLength(calls);
    });

    it("retains the referenced object when the commit acknowledgement is lost", async () => {
      await open();
      await seedJobs(preprod, 1);
      const { sourceImportSyncService } = await import(
        "@/services/source-import-sync.service"
      );
      const importBlobs = sourceImportSyncService.importPendingResultBlobs;
      const spy = vi
        .spyOn(sourceImportSyncService, "importPendingResultBlobs")
        .mockImplementationOnce((options) =>
          importBlobs({
            ...options,
            write: async (work) => {
              await options.write(work);
              throw new Error("Commit acknowledgement lost");
            },
          }),
        );
      expectCoreLog("error", "A scheduled sync failed");
      try {
        await run("preprod");
      } finally {
        spy.mockRestore();
      }
      expect(await preprod.blob.findFirstOrThrow()).toMatchObject({
        status: "READY",
        fileUrl: "https://blob.test/preprod/jobs/job/job-1.md",
      });
      expect(uploads.map((upload) => upload.pathname)).toEqual([
        "preprod/jobs/job/job-1.md",
      ]);
      expect(state.calls.map(([method]) => method)).toEqual(["put", "head"]);
    });

    it("lets Mainnet finish while Preprod is stuck at storage", async () => {
      await open();
      await seedJobs(preprod, 1);
      await seedJobs(main, 1);
      await seedTasks(shared, 1);
      const held = Promise.withResolvers<Response>();
      state.fetch.mockImplementationOnce(() => held.promise);
      const running = run("preprod");
      try {
        await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
        expect(await run("preprod")).toEqual([
          409,
          { message: "Syncing already in progress" },
        ]);
        expect(await run()).toEqual([200, { message: "Syncing started" }]);
        expect((await main.blob.findFirstOrThrow()).status).toBe("READY");
        expect((await shared.taskFile.findFirstOrThrow()).status).toBe("READY");
        expect((await preprod.blob.findFirstOrThrow()).status).toBe("PENDING");
      } finally {
        held.resolve(new Response("file"));
        await running;
      }
    });
    it.each(["pause", "raise"] as const)(
      "removes its upload if %s wins before publication",
      async (action) => {
        await open();
        await seedJobs(preprod, 1);
        const held = Promise.withResolvers<void>();
        const reached = Promise.withResolvers<void>();
        const head = vi
          .spyOn(blobStore, "head")
          .mockImplementationOnce(async () => {
            reached.resolve();
            await held.promise;
            return { contentType: "text/markdown", size: 1234 };
          });
        const running = run("preprod");
        try {
          await reached.promise;
          expect(uploads).toHaveLength(1);
          await change(action);
        } finally {
          held.resolve();
          await running;
          head.mockRestore();
        }
        expect(await preprod.blob.findFirstOrThrow()).toMatchObject({
          fileUrl: null,
          status: "PENDING",
        });
        expect(uploads).toHaveLength(0);
        expect(coreLogEvents()).toContainEqual(
          expect.objectContaining({
            sync: expect.objectContaining({ outcome: "skipped" }),
          }),
        );
      },
    );
    it("reports a cleanup failure even when another worker skipped after pause", async () => {
      await open();
      await seedJobs(preprod, 2);
      const held = Promise.withResolvers<void>();
      const metadata = blobStore.head;
      const head = vi.spyOn(blobStore, "head").mockImplementation(async () => {
        await held.promise;
        return metadata();
      });
      const remove = blobStore.del;
      const del = vi.spyOn(blobStore, "del").mockImplementation(async (url) => {
        if (url.endsWith("job-2.md")) throw new Error("Storage unavailable");
        await remove(url);
      });
      expectCoreLog("error", "A scheduled sync failed");
      const running = run("preprod");
      try {
        await vi.waitFor(() => expect(head).toHaveBeenCalledTimes(2));
        await change("pause");
      } finally {
        held.resolve();
        await running;
        head.mockRestore();
        del.mockRestore();
      }
      expect(
        await preprod.blob.count({
          where: { status: "PENDING", fileUrl: null },
        }),
      ).toBe(2);
      expect(uploads.map(({ pathname }) => pathname)).toEqual([
        "preprod/jobs/job/job-2.md",
      ]);
      expect(state.checkIn.mock.calls.at(-1)?.[0]).toMatchObject({
        status: "error",
      });
    });

    it.each(["pause", "raise"] as const)(
      "serializes %s after a write that won the fence",
      async (action) => {
        await open();
        await seedJobs(preprod, 1);
        const held = holdCommit("import", 2);
        const running = inFlow("import", () => run("preprod"));
        let changing: ReturnType<typeof change> | undefined;
        try {
          await held.reached;
          changing = change(action);
          await vi.waitFor(async () => {
            const [row] = await shared.$queryRaw<
              { blocked: boolean }[]
            >`SELECT EXISTS (SELECT FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0) AS blocked`;
            expect(row.blocked).toBe(true);
          });
        } finally {
          held.release();
          await Promise.all([running, changing]);
        }
        expect((await preprod.blob.findFirstOrThrow()).status).toBe("READY");
        expect(uploads).toHaveLength(1);
      },
    );
  });

  it("excludes the legacy combined lock in both orders", async () => {
    const { syncLockService } = await import("@/services/sync-lock.service");
    await seedJobs(main, 1);
    const legacy = await syncLockService.acquireLock(key);
    try {
      expect(await run()).toEqual([
        409,
        { message: "Syncing already in progress" },
      ]);
      expect(state.calls).toEqual([]);
    } finally {
      await syncLockService.releaseLock(key, legacy.ownerToken);
    }
    const held = Promise.withResolvers<Response>();
    state.fetch.mockImplementationOnce(() => held.promise);
    const running = run();
    try {
      await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
      await expect(syncLockService.acquireLock(key)).rejects.toThrow(
        "LOCK_IS_LOCKED",
      );
    } finally {
      held.resolve(new Response("file"));
      await running;
    }
    expect(uploads).toHaveLength(1);
  });
});

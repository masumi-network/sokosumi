import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";

/**
 * The copy sweep shares the drive-index tick with ordinary indexing. It runs
 * last and on its own, so a copy that cannot be settled never stops the
 * extraction or suggestion work of the tick.
 */

const { acquire, release, pending, env, stages } = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  pending: [] as Promise<unknown>[],
  env: {
    VERCEL_ENV: "test",
    CRON_SECRET: "test-secret",
    LOCK_TIMEOUT: 120_000,
    LOCK_TIMEOUT_BUFFER: 25_000,
    INSTANCE_ID: "instance-under-test",
  },
  stages: {
    order: [] as string[],
    copies: vi.fn(),
    run: (name: string) => async () => {
      stages.order.push(name);
      return 0;
    },
  },
}));

vi.mock("@/config/env", () => ({ getEnv: () => env }));
vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: { acquireLock: acquire, releaseLock: release },
}));
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: vi.fn((work: Promise<unknown>) => {
    pending.push(work);
  }),
}));
vi.mock("@/lib/files/index-jobs", () => ({
  backfillMissingSuggestionJobs: stages.run("backfill"),
  reviveFailedSuggestionJobs: stages.run("revive"),
}));
vi.mock("@/lib/files/jev-admission", () => ({
  pruneExpiredAdmissions: stages.run("admissions"),
}));
vi.mock("@/lib/files/search-session", () => ({
  pruneExpiredResultWindows: stages.run("windows"),
}));
vi.mock("@/services/file-index.service", () => ({
  processFileIndexJobs: stages.run("extraction"),
}));
vi.mock("@/services/file-suggestions.service", () => ({
  processFileSuggestionJobs: stages.run("suggestions"),
}));
vi.mock("@/services/file-table-index.service", () => ({
  processStaleTableIndexes: stages.run("tables"),
}));
vi.mock("@/services/drive-copy-reconcile", () => ({
  reconcileStaleDriveCopies: stages.copies,
}));

import mount from "./get";

beforeEach(() => {
  stages.order.length = 0;
  pending.length = 0;
  acquire.mockResolvedValue({ key: "drive-index-sync", ownerToken: "o" });
  release.mockResolvedValue(true);
});

async function tick() {
  const app = new Hono();
  mount(app);
  const response = await app.request("/drive-index", {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  await Promise.all(pending);
  return response;
}

describe("the drive-index tick", () => {
  it("indexes first, then settles copies within the tick's time", async () => {
    stages.copies.mockImplementation(async () => {
      stages.order.push("copies");
      return { published: 0, released: 0, kept: 0, failed: 0 };
    });

    expect((await tick()).status).toBe(200);
    expect(stages.order.at(-1)).toBe("copies");
    expect(stages.order).toContain("extraction");
    expect(stages.copies).toHaveBeenCalledWith({
      shouldContinue: expect.any(Function),
    });
  });

  it("still indexes when the copy sweep fails", async () => {
    expectCoreLog("warn", "Drive copy sweep failed");
    stages.copies.mockRejectedValue(new Error("database down"));

    await tick();

    expect(stages.order).toEqual(
      expect.arrayContaining(["extraction", "suggestions", "tables"]),
    );
    expect(release).toHaveBeenCalled();
  });
});

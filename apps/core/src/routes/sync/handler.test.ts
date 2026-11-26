import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";

const { acquireLock, captureCheckIn, flush, pending, releaseLock } = vi.hoisted(
  () => ({
    acquireLock: vi.fn(),
    captureCheckIn: vi.fn((..._args: unknown[]) => "check-in-id"),
    flush: vi.fn(async () => true),
    pending: [] as Promise<unknown>[],
    releaseLock: vi.fn(async () => true),
  }),
);

vi.mock("@sentry/node", () => ({ captureCheckIn, flush }));
vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((work: Promise<unknown>) => {
    pending.push(work);
  }),
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "secret",
    LOCK_TIMEOUT: 300_000,
    LOCK_TIMEOUT_BUFFER: 10_000,
  }),
}));
vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: { acquireLock, releaseLock },
}));

import { handleSyncRequest, type SyncRequestOptions } from "./handler";

/** A cron Vercel runs every ten minutes (`vercel.json`). */
const PATH = "/sync/cmo-production";

async function run(
  operation: Parameters<typeof handleSyncRequest>[2],
  options?: SyncRequestOptions,
  path = PATH,
): Promise<Response> {
  const app = new Hono();
  app.get(path, (c) => handleSyncRequest(c, "lock-key", operation, options));
  const response = await app.request(`http://localhost${path}`, {
    headers: { Authorization: "Bearer secret" },
  });
  await Promise.all(pending.splice(0));
  return response;
}

type CheckIn = { monitorSlug: string; status: string };

/** The end status of each monitor's check-ins, by monitor. */
const finished = (monitorSlug = "lock-key") =>
  captureCheckIn.mock.calls
    .map(([checkIn]) => checkIn as CheckIn)
    .filter(
      (checkIn) =>
        checkIn.monitorSlug === monitorSlug && checkIn.status !== "in_progress",
    )
    .map((checkIn) => checkIn.status);

describe("cron monitors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireLock.mockResolvedValue({ key: "lock-key", ownerToken: "owner" });
  });

  it("checks a run in with its vercel.json schedule, then ok, and flushes", async () => {
    await run(async () => undefined);

    expect(captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: "lock-key", status: "in_progress" },
      expect.objectContaining({
        schedule: { type: "crontab", value: "*/10 * * * *" },
        failureIssueThreshold: 3,
        maxRuntime: 6,
      }),
    );
    expect(captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "lock-key",
      status: "ok",
      duration: expect.any(Number),
    });
    expect(flush).toHaveBeenCalled();
  });

  it("fails the check-in of a sync that threw", async () => {
    expectCoreLog("error", "A scheduled sync failed");
    await run(async () => {
      throw new Error("boom");
    });
    expect(finished()).toEqual(["error"]);
  });

  it("counts an opted-in run with no work on its idle monitor, after N runs", async () => {
    await run(async ({ reportWork }) => reportWork({ done: 0 }), {
      idleRunsAlert: 6,
    });
    expect(finished()).toEqual(["ok"]);
    expect(finished("lock-key-idle")).toEqual(["error"]);
    const idleCheckIn = captureCheckIn.mock.calls.find(
      ([checkIn]) => (checkIn as CheckIn).monitorSlug === "lock-key-idle",
    );
    expect(idleCheckIn?.[1]).toMatchObject({ failureIssueThreshold: 6 });

    captureCheckIn.mockClear();
    await run(async ({ reportWork }) => reportWork({ done: 4 }), {
      idleRunsAlert: 6,
    });
    expect(finished()).toEqual(["ok"]);
    expect(finished("lock-key-idle")).toEqual(["ok"]);
  });

  it("fails a run whose five claimed jobs all failed, and never reads it as idle or healthy", async () => {
    await run(async ({ reportWork }) => reportWork({ done: 0, failed: 5 }), {
      idleRunsAlert: 60,
    });
    expect(finished()).toEqual(["error"]);
    expect(finished("lock-key-idle")).toEqual(["ok"]);
  });

  it("keeps a run with some work done healthy beside a failed item", async () => {
    await run(async ({ reportWork }) => reportWork({ done: 3, failed: 1 }));
    expect(finished()).toEqual(["ok"]);
  });

  it("does not watch idleness of a sync that did not opt in", async () => {
    await run(async ({ reportWork }) => reportWork({ done: 0 }));
    expect(finished()).toEqual(["ok"]);
    expect(finished("lock-key-idle")).toEqual([]);
  });

  it("tells the monitor a cron is alive when the last run still holds the lock", async () => {
    acquireLock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    const response = await run(async () => undefined);
    expect(response.status).toBe(409);
    expect(captureCheckIn.mock.calls).toEqual([
      [{ monitorSlug: "lock-key", status: "ok" }],
    ]);
    // Flushed under waitUntil, so the 409 cannot freeze it unsent.
    expect(flush).toHaveBeenCalledOnce();
  });

  describe("an opted-in cron's idle monitor across ticks", () => {
    const N = 3;
    /** Sentry's view: a tick without a check-in is missed, errors in a row open an issue. */
    const idleMonitor = () => {
      const statuses = finished("lock-key-idle");
      let streak = 0;
      let longest = 0;
      for (const status of statuses) {
        streak = status === "error" ? streak + 1 : 0;
        longest = Math.max(longest, streak);
      }
      return { checkIns: statuses.length, alerts: longest >= N };
    };

    it("checks in on ticks that threw, without counting them as idle", async () => {
      expectCoreLog("error", "A scheduled sync failed", 2 * N);
      for (let tick = 0; tick < 2 * N; tick++)
        await run(
          async () => {
            throw new Error("boom");
          },
          { idleRunsAlert: N },
        );
      expect(idleMonitor()).toEqual({ checkIns: 2 * N, alerts: false });
    });

    it("checks in on ticks that overlapped the last run, without counting them as idle", async () => {
      acquireLock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
      for (let tick = 0; tick < 2 * N; tick++)
        await run(async () => undefined, { idleRunsAlert: N });
      expect(idleMonitor()).toEqual({ checkIns: 2 * N, alerts: false });
      expect(finished()).toEqual(Array(2 * N).fill("ok"));
    });

    it("still alerts after N observed runs with no work", async () => {
      for (let tick = 0; tick < N; tick++)
        await run(async ({ reportWork }) => reportWork({ done: 0 }), {
          idleRunsAlert: N,
        });
      expect(idleMonitor()).toEqual({ checkIns: N, alerts: true });
    });
  });

  it("has no monitor for a path Vercel does not schedule", async () => {
    await run(async () => undefined, undefined, "/sync/not-scheduled");
    expect(captureCheckIn).not.toHaveBeenCalled();
  });
});
